import type {
  OpenAPIDocument,
  Operation,
  Parameter,
  RequestBody,
  Schema,
  Ref,
} from './types.js'
import { isRef } from './types.js'
import type { ToolDefinition, ParamDefinition, ToolsConfig } from '../types.js'

export interface ConvertResult {
  config: ToolsConfig
  /** Non-fatal observations the caller may want to surface (skipped operations, dropped params, …). */
  warnings: string[]
}

/** Convert a parsed OpenAPI document into the tools.yaml shape. Pure / sync — IO lives in load.ts. */
export function convertOpenAPIToTools(doc: OpenAPIDocument): ConvertResult {
  if (doc.swagger) {
    throw new Error(
      `OpenAPI 3.x is required. The document advertises Swagger ${doc.swagger}. ` +
      'Convert to OpenAPI 3 first (https://converter.swagger.io/).',
    )
  }
  if (!doc.openapi || !/^3\./.test(doc.openapi)) {
    throw new Error(`Unsupported OpenAPI version: ${doc.openapi ?? 'missing'}. Expected 3.x.`)
  }
  if (!doc.paths) {
    throw new Error('OpenAPI document has no paths.')
  }

  const warnings: string[] = []
  const tools: ToolDefinition[] = []
  const seenNames = new Set<string>()

  for (const [path, item] of Object.entries(doc.paths)) {
    if (!item) continue
    const sharedParameters = item.parameters ?? []
    for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
      const op = item[method]
      if (!op) continue
      if (op.deprecated) {
        warnings.push(`Skipped ${method.toUpperCase()} ${path} — operation marked deprecated.`)
        continue
      }
      const tool = operationToTool(method, path, op, sharedParameters, doc, warnings)
      if (!tool) continue
      const finalName = ensureUniqueName(tool.name, seenNames)
      if (finalName !== tool.name) {
        warnings.push(`Renamed duplicate operationId "${tool.name}" → "${finalName}".`)
      }
      tool.name = finalName
      seenNames.add(finalName)
      tools.push(tool)
    }
  }

  return {
    config: { tools_yaml_version: '1.0', tools },
    warnings,
  }
}

function operationToTool(
  method: 'get' | 'post' | 'put' | 'patch' | 'delete',
  path: string,
  op: Operation,
  sharedParameters: Array<Parameter | Ref>,
  doc: OpenAPIDocument,
  warnings: string[],
): ToolDefinition | null {
  const name = sanitizeName(op.operationId ?? `${method}_${path}`)
  const description = pickDescription(op) ?? `${method.toUpperCase()} ${path}`

  // path params: convert OpenAPI {id} to aiglue :id syntax
  const aigluePath = path.replace(/\{([^}]+)\}/g, ':$1')

  const params: Record<string, ParamDefinition> = {}
  const allParameters = [...sharedParameters, ...(op.parameters ?? [])]
  for (const rawParam of allParameters) {
    const param = resolveRef(rawParam, doc, 'parameters')
    if (!param) {
      warnings.push(`${method.toUpperCase()} ${path}: skipped parameter with unresolved $ref.`)
      continue
    }
    if (param.in === 'header' || param.in === 'cookie') {
      // Header / cookie params are typically auth — aiglue's authToken handles that path separately.
      continue
    }
    const def = parameterToDef(param, doc)
    if (!def) {
      warnings.push(`${method.toUpperCase()} ${path}: skipped parameter "${param.name}" — could not derive type.`)
      continue
    }
    params[param.name] = def
  }

  // Body params (POST/PUT/PATCH) — flatten the JSON request schema's properties to top-level params,
  // matching how aiglue executor merges params into the body.
  if (op.requestBody) {
    const body = resolveRef(op.requestBody, doc, 'requestBodies')
    if (!body) {
      warnings.push(`${method.toUpperCase()} ${path}: skipped requestBody with unresolved $ref.`)
    } else {
      const jsonContent = body.content?.['application/json']
      const schema = jsonContent?.schema ? resolveSchema(jsonContent.schema, doc) : null
      if (schema?.properties) {
        const required = new Set(schema.required ?? [])
        for (const [propName, propSchema] of Object.entries(schema.properties)) {
          const resolved = resolveSchema(propSchema, doc)
          if (!resolved) continue
          if (params[propName]) {
            warnings.push(
              `${method.toUpperCase()} ${path}: requestBody property "${propName}" collides with a path/query param — body wins.`,
            )
          }
          params[propName] = schemaToParamDef(resolved, body.required === true && required.has(propName))
        }
      }
    }
  }

  const tool: ToolDefinition = {
    name,
    description,
    endpoint: `${method.toUpperCase()} ${aigluePath}`,
    risk_level: inferRiskLevel(method),
  }
  if (Object.keys(params).length > 0) tool.params = params

  const responseType = inferResponseType(op, doc)
  if (responseType) tool.response_type = responseType

  // confirm_message left blank for write/critical — user fills in (lint rule will flag missing if desired).
  return tool
}

function pickDescription(op: Operation): string | undefined {
  const summary = (op.summary ?? '').trim()
  const description = (op.description ?? '').trim()
  if (summary && description) return `${summary}. ${description}`
  return summary || description || undefined
}

function inferRiskLevel(method: string): ToolDefinition['risk_level'] {
  if (method === 'get') return 'read'
  if (method === 'delete') return 'critical'
  return 'write'
}

function inferResponseType(op: Operation, doc: OpenAPIDocument): ToolDefinition['response_type'] | undefined {
  const success = op.responses?.['200'] ?? op.responses?.['201'] ?? op.responses?.['default']
  if (!success) return undefined
  const resolved = resolveRef(success, doc, 'responses')
  if (!resolved) return undefined
  const json = resolved.content?.['application/json']
  if (!json?.schema) return undefined
  const schema = resolveSchema(json.schema, doc)
  if (!schema) return undefined
  if (schema.type === 'array') return 'table'
  if (schema.type === 'object') return 'text'
  return undefined
}

function parameterToDef(param: Parameter, doc: OpenAPIDocument): ParamDefinition | null {
  const schema = param.schema ? resolveSchema(param.schema, doc) : null
  if (!schema && !param.description) return null
  const def: ParamDefinition = {
    description: param.description ?? param.name,
  }
  if (schema) {
    const t = openAPITypeToAIGlueType(schema)
    if (t) def.type = t
    if (Array.isArray(schema.enum)) def.enum = schema.enum.map(String)
    if (schema.default !== undefined) def.default = schema.default
  }
  if (param.required === true) def.required = true
  return def
}

function schemaToParamDef(schema: Schema, required: boolean): ParamDefinition {
  const def: ParamDefinition = {
    description: schema.description ?? '',
  }
  const t = openAPITypeToAIGlueType(schema)
  if (t) def.type = t
  if (Array.isArray(schema.enum)) def.enum = schema.enum.map(String)
  if (schema.default !== undefined) def.default = schema.default
  if (required) def.required = true
  return def
}

function openAPITypeToAIGlueType(schema: Schema): string | undefined {
  if (schema.type === 'integer' || schema.type === 'number') return 'number'
  if (schema.type === 'boolean') return 'boolean'
  if (schema.type === 'string') return 'string'
  // Composition / arrays / objects fall back to string at the param level — too varied for a flat tool param.
  return undefined
}

type RefBucket = 'parameters' | 'requestBodies' | 'schemas' | 'responses'

function resolveRef<T>(value: T | Ref, doc: OpenAPIDocument, bucket: RefBucket): T | null {
  if (!isRef(value)) return value
  const match = value.$ref.match(/^#\/components\/(\w+)\/(.+)$/)
  if (!match) return null
  const [, kind, key] = match
  if (kind !== bucket) return null
  const components = (doc.components as Record<string, Record<string, unknown>> | undefined)?.[kind]
  if (!components) return null
  const target = components[key]
  if (target === undefined) return null
  return target as T
}

function resolveSchema(value: Schema | Ref, doc: OpenAPIDocument, depth = 0): Schema | null {
  if (depth > 10) return null
  if (!isRef(value)) return value
  const match = value.$ref.match(/^#\/components\/schemas\/(.+)$/)
  if (!match) return null
  const target = doc.components?.schemas?.[match[1]]
  if (!target) return null
  return resolveSchema(target, doc, depth + 1)
}

function sanitizeName(raw: string): string {
  // Strip leading/trailing punctuation, replace runs of non-alphanumerics with underscore,
  // lowercase. tools.yaml lint requires snake_case-ish names.
  const cleaned = raw
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()
  return cleaned || 'unnamed_tool'
}

function ensureUniqueName(base: string, seen: Set<string>): string {
  if (!seen.has(base)) return base
  let i = 2
  while (seen.has(`${base}_${i}`)) i++
  return `${base}_${i}`
}

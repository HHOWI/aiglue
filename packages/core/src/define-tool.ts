import { ZodObject } from 'zod'
import type { ToolDefinition } from './types.js'

const PATH_PARAM_RE = /:([a-zA-Z_][a-zA-Z0-9_]*)/g

export function defineTool<T extends Record<string, import('zod').ZodTypeAny>>(
  def: ToolDefinition<T>,
): ToolDefinition<T> {
  validateDefinition(def)
  return def
}

export function validateDefinition(def: ToolDefinition): void {
  // params must be a ZodObject when provided
  if (def.params !== undefined && !(def.params instanceof ZodObject)) {
    throw new Error(
      `[aiglue] tool "${def.name}": params must be a zod ZodObject (got ${typeof def.params})`,
    )
  }

  // path-key-mismatch: every :key in endpoint path must be present in params shape
  const path = def.endpoint.split(' ').slice(1).join(' ')
  const pathKeys = Array.from(path.matchAll(PATH_PARAM_RE)).map(m => m[1])
  if (pathKeys.length > 0) {
    const shape = def.params?.shape ?? {}
    for (const key of pathKeys) {
      if (!(key in shape)) {
        throw new Error(
          `[aiglue] tool "${def.name}": path-key-mismatch — endpoint references ':${key}' but params has no '${key}'`,
        )
      }
    }
  }

  // confirm-required-on-write
  if ((def.riskLevel === 'write' || def.riskLevel === 'critical') && !def.confirmMessage) {
    throw new Error(
      `[aiglue] tool "${def.name}": confirm-required-on-write — riskLevel='${def.riskLevel}' requires confirmMessage`,
    )
  }

  // table-needs-columns
  if (def.responseType === 'table' && (!def.columns || def.columns.length === 0)) {
    throw new Error(
      `[aiglue] tool "${def.name}": table-needs-columns — responseType='table' requires columns[]`,
    )
  }

  // summary-requires-table: summary needs structured data (columns or responseMapping.dataPath)
  if (def.responseType === 'summary') {
    const hasStructure = (def.columns && def.columns.length > 0) || def.responseMapping?.dataPath
    if (!hasStructure) {
      throw new Error(
        `[aiglue] tool "${def.name}": summary-requires-table — responseType='summary' needs columns[] or responseMapping.dataPath`,
      )
    }
  }
}

// Minimal subset of the OpenAPI 3.0 / 3.1 schema — only the shapes the converter actually inspects.
// Anything we do not look at is left as `unknown` to avoid pretending we understand the full spec.

export interface OpenAPIDocument {
  openapi?: string
  swagger?: string // 2.0 — explicitly rejected by the converter; kept here so we can detect it
  info?: { title?: string; version?: string }
  servers?: Array<{ url: string }>
  paths?: Record<string, PathItem>
  components?: {
    schemas?: Record<string, Schema>
    parameters?: Record<string, Parameter>
    requestBodies?: Record<string, RequestBody>
  }
}

export interface PathItem {
  get?: Operation
  post?: Operation
  put?: Operation
  patch?: Operation
  delete?: Operation
  parameters?: Array<Parameter | Ref>
}

export interface Operation {
  operationId?: string
  summary?: string
  description?: string
  parameters?: Array<Parameter | Ref>
  requestBody?: RequestBody | Ref
  responses?: Record<string, Response | Ref>
  deprecated?: boolean
}

export interface Parameter {
  name: string
  in: 'query' | 'path' | 'header' | 'cookie'
  description?: string
  required?: boolean
  schema?: Schema | Ref
}

export interface RequestBody {
  description?: string
  required?: boolean
  content?: Record<string, MediaType>
}

export interface Response {
  description?: string
  content?: Record<string, MediaType>
}

export interface MediaType {
  schema?: Schema | Ref
}

export interface Schema {
  type?: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object'
  format?: string
  description?: string
  enum?: unknown[]
  default?: unknown
  properties?: Record<string, Schema | Ref>
  items?: Schema | Ref
  required?: string[]
  // Composition / polymorphism — handled minimally (the converter falls back to type: string for these).
  oneOf?: Array<Schema | Ref>
  anyOf?: Array<Schema | Ref>
  allOf?: Array<Schema | Ref>
}

export interface Ref {
  $ref: string
}

export function isRef(value: unknown): value is Ref {
  return typeof value === 'object' && value !== null && '$ref' in value
}

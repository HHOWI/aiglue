// ── tools.yaml 스펙 타입 ──

export interface ToolsConfig {
  tools_yaml_version: string
  tools: ToolDefinition[]
}

export interface ToolDefinition {
  name: string
  description: string
  endpoint: string
  params?: Record<string, ParamDefinition>
  request_body_template?: Record<string, unknown>
  response_mapping?: ResponseMapping
  columns?: ColumnDefinition[]
  examples?: string[]
  response_type?: 'text' | 'table' | 'chart' | 'auto'
  risk_level?: 'read' | 'write' | 'critical'
  confirm_message?: string
  rate_limit?: string
}

export interface ParamDefinition {
  description: string
  type?: string
  required?: boolean
  default?: unknown
  enum?: string[]
  map_from?: string
}

export interface ResponseMapping {
  data_path?: string
  total_path?: string
}

export interface ColumnDefinition {
  key: string
  label: string
  type?: 'string' | 'number' | 'date' | 'badge'
}

// ── AIE 응답 타입 ──

export type AIEResponse =
  | AIETextResponse
  | AIETableResponse
  | AIEActionResponse
  | AIEConfirmResponse
  | AIEClarifyResponse
  | AIEErrorResponse

export interface AIETextResponse {
  type: 'text'
  content: string
}

export interface AIETableResponse {
  type: 'table'
  columns: ColumnDefinition[]
  rows: Record<string, unknown>[]
  total?: number
  summary?: string
}

export interface AIEActionResponse {
  type: 'action'
  status: 'success' | 'failed'
  message: string
}

export interface AIEConfirmResponse {
  type: 'confirm'
  message: string
  toolName: string
  params: Record<string, unknown>
}

export interface AIEClarifyResponse {
  type: 'clarify'
  question: string
  options?: string[]
}

export interface AIEErrorResponse {
  type: 'error'
  message: string
  code: string
}

// ── LLM Provider 타입 ──

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface LLMToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface LLMToolCallResult {
  toolName: string
  params: Record<string, unknown>
}

export interface LLMResponse {
  toolCall: LLMToolCallResult | null
  textContent: string | null
  tokensIn: number
  tokensOut: number
}

// ── Engine 설정 타입 ──

export interface AIEngineConfig {
  tools: string
  domainDocs?: string
  llm: LLMConfig
  auth?: AuthConfig
  rateLimiting?: RateLimitConfig
  baseUrl?: string
}

export interface LLMConfig {
  provider: 'claude' | 'openai-compatible'
  apiKey?: string
  model?: string
  baseUrl?: string
  keyMode?: 'server' | 'user' | 'both'
}

export interface AuthConfig {
  type: 'bearer' | 'api-key' | 'none'
  token?: string | ((req: unknown) => string | undefined)
}

export interface RateLimitConfig {
  global?: string
  perUser?: string
}

// ── 로그 타입 ──

export interface RequestLog {
  timestamp: string
  userId?: string
  input: string
  resolvedTool: string | null
  params: Record<string, unknown> | null
  latencyMs: number
  llmTokensIn: number
  llmTokensOut: number
  success: boolean
  responseType: string
  error?: string
}

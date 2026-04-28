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
  response_type?: 'text' | 'table' | 'raw' | 'summary'
  // TODO(roadmap): 'chart' | 'auto' response types planned for v1.5
  /** When true on a `response_type: table` tool, adds an LLM-generated summary string
   *  to the AIETableResponse. Ignored for other response types. */
  include_summary?: boolean
  risk_level?: 'read' | 'write' | 'critical'
  confirm_message?: string
  rate_limit?: string
  sensitive_params?: string[]
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
  | AIERawResponse
  | AIESummaryResponse
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

export interface AIERawResponse {
  type: 'raw'
  data: unknown
}

export interface AIESummaryResponse {
  type: 'summary'
  text: string
  /** Original tool result, exposed for "show details" UIs. Optional and opaque. */
  source?: unknown
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
  /** Server-issued. Echo back via confirmAndExecute to dedupe duplicate confirm submissions. */
  confirmToken?: string
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

export interface MessagesConfig {
  confirmPrompt?: (toolName: string, params: Record<string, unknown>) => string
  actionComplete?: (toolName: string) => string
  cancelledMessage?: string
  emptyMessageError?: string
  toolNotAvailableError?: string
  rateLimitedError?: string
  internalError?: string
  /** Shown when the upstream API returns a non-2xx status. Raw upstream details stay in logs only. */
  upstreamError?: string
}

export interface AIEngineConfig {
  tools: string
  domainDocs?: string
  llm: LLMConfig
  auth?: AuthConfig
  rateLimiting?: RateLimitConfig
  baseUrl?: string
  history?: HistoryConfig
  messages?: MessagesConfig
  executor?: ExecutorConfig
  hotReload?: HotReloadConfig
  routing?: RoutingConfig
  /** When true, the engine registers SIGTERM and SIGINT handlers that call dispose() automatically.
   *  Default false — the host (Express, Koa, Fastify, …) usually owns shutdown signals. */
  disposeOnSignal?: boolean
}

export interface RoutingConfig {
  /** 'single' (default) sends every tool definition to the LLM each request — simple and reliable for
   *  small catalogs. 'two-stage' routes the request through a lightweight index first and only sends
   *  the full definitions for the candidates the index picked — useful when tools.yaml grows past
   *  ~30 entries and the per-request token cost starts hurting. */
  strategy?: 'single' | 'two-stage'
}

export interface HotReloadConfig {
  /** Poll interval in ms for tools.yaml mtime changes. Default 0 (disabled).
   *  Set e.g. 5000 to auto-reload every 5s when the file mtime changes.
   *  engine.reload() works regardless of this setting. */
  pollIntervalMs?: number
}

export interface ExecutorConfig {
  /** Per-request HTTP timeout in ms. Default 10000. */
  timeoutMs?: number
  /** Hard cap on upstream response body size in bytes. Default 5_242_880 (5 MB). */
  maxResponseBytes?: number
}

export interface HistoryConfig {
  /** Maximum number of conversation messages to retain. Default 10. Oldest dropped first when exceeded. */
  maxMessages?: number
  /** Approximate token cap for the history window (~4 chars/token estimate). Older messages dropped first when exceeded.
   *  The most recent message is always kept even if it alone exceeds the cap. */
  maxTokens?: number
}

export interface LLMConfig {
  provider: 'claude' | 'openai-compatible'
  apiKey?: string
  model?: string
  baseUrl?: string
  keyMode?: 'server' | 'user' | 'both'
  /** Per-request timeout in ms for LLM calls (resolve + chat). Default 30000. */
  timeoutMs?: number
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

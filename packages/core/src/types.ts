// ── Tool definition and engine types ──

import type { ZodObject, ZodRawShape } from 'zod'

export interface ToolDefinition<TParams extends ZodRawShape = ZodRawShape> {
  name: string
  description: string
  endpoint: string
  params?: ZodObject<TParams>
  requestBodyTemplate?: Record<string, unknown>
  responseMapping?: ResponseMapping
  responseType?: 'text' | 'table' | 'raw' | 'summary'
  columns?: ColumnDefinition[]
  includeSummary?: boolean
  riskLevel?: 'read' | 'write' | 'critical'
  confirmMessage?: string
  rateLimit?: string
  sensitiveParams?: string[]
  examples?: string[]
  shortDescription?: string
}

export interface ResponseMapping {
  dataPath?: string
  totalPath?: string
}

export interface ColumnDefinition {
  key: string
  label: string
  type?: 'string' | 'number' | 'date' | 'badge'
}

// ── AIE 응답 타입 ──

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

export interface AIEMultiResponse {
  type: 'multi'
  results: Exclude<AIEResponse, AIEMultiResponse>[]
}

export type AIEResponse =
  | AIETextResponse
  | AIETableResponse
  | AIERawResponse
  | AIESummaryResponse
  | AIEActionResponse
  | AIEConfirmResponse
  | AIEClarifyResponse
  | AIEErrorResponse
  | AIEMultiResponse

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
  toolCalls: LLMToolCallResult[]
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
  tools: ToolDefinition[]
  domainDocs?: string
  /** Optional. Defaults to `{ provider: 'claude' }`, which lets the Anthropic SDK pick up
   *  ANTHROPIC_API_KEY from the environment. Override for OpenAI-compatible / custom providers. */
  llm?: LLMConfig
  auth?: AuthConfig
  rateLimiting?: RateLimitConfig
  baseUrl?: string
  history?: HistoryConfig
  messages?: MessagesConfig
  executor?: ExecutorConfig
  routing?: RoutingConfig
  observability?: ObservabilityConfig
  /** When true, the engine registers SIGTERM and SIGINT handlers that call dispose() automatically.
   *  Default false — the host (Express, Koa, Fastify, …) usually owns shutdown signals. */
  disposeOnSignal?: boolean
}

export interface ObservabilityConfig {
  /** OpenTelemetry-compatible tracer. Pass `trace.getTracer('aiglue')` from `@opentelemetry/api` to
   *  emit spans for processMessage / confirmAndExecute. Type is intentionally structural so aiglue
   *  does not pin a specific OTel SDK version. */
  tracer?: import('./observability/tracer.js').TracerLike
}

export interface RoutingConfig {
  /** 'single' sends every tool definition to the LLM each request — simple and reliable for small
   *  catalogs. 'two-stage' routes the request through a lightweight index first and only sends the
   *  full definitions for the candidates the index picked — useful when tools.yaml grows past
   *  ~30 entries and the per-request token cost starts hurting. 'auto' (default) picks 'single'
   *  for catalogs below `twoStageThreshold` and 'two-stage' at or above. */
  strategy?: 'auto' | 'single' | 'two-stage'
  /** Tool-count threshold at which 'auto' switches from 'single' to 'two-stage'. Default 30. */
  twoStageThreshold?: number
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
  /** 'claude' / 'openai-compatible' use the bundled providers. 'custom' lets the caller pass any
   *  object that implements the LLMProvider interface — useful for AWS Bedrock, internal LLM gateways,
   *  Azure OpenAI, or test mocks. */
  provider: 'claude' | 'openai-compatible' | 'custom'
  apiKey?: string
  model?: string
  baseUrl?: string
  keyMode?: 'server' | 'user' | 'both'
  /** Per-request timeout in ms for LLM calls (resolve + chat). Default 30000. */
  timeoutMs?: number
  /** Required when provider === 'custom'. The instance handles every resolve / chat call directly. */
  instance?: import('./providers/types.js').LLMProvider
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

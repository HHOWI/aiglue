import { randomUUID } from 'crypto'
import { statSync } from 'fs'
import { ToolRegistry } from './tool-registry.js'
import { ClaudeProvider } from './providers/claude.js'
import { OpenAIProvider } from './providers/openai.js'
import type { LLMProvider } from './providers/types.js'
import { IntentResolver, CLARIFY_META_TOOL } from './intent-resolver.js'
import { SafetyGate } from './safety.js'
import { Executor } from './executor.js'
import { ResponseFormatter } from './response-formatter.js'
import { Summarizer } from './summarizer.js'
import { RateLimiter } from './rate-limiter.js'
import { IdempotencyStore } from './idempotency.js'
import { Router } from './routing/router.js'
import { Logger, redactParams } from './logger.js'
import { DEFAULT_MESSAGES } from './messages.js'
import { validateAIEngineConfig } from './config-validate.js'
import { NO_OP_TRACER, SpanStatus, setAttr } from './observability/tracer.js'
import type { SpanLike, TracerLike } from './observability/tracer.js'
import type { AIEngineConfig, AIEResponse, ChatMessage, MessagesConfig } from './types.js'

export interface HandlerRequest {
  headers?: Record<string, string | string[] | undefined>
  body?: {
    message?: string
    userId?: string
    action?: string
    toolName?: string
    params?: Record<string, unknown>
    history?: ChatMessage[]
    idempotencyKey?: string
  }
}

export interface HandlerResponse {
  json(data: unknown): void
}

export interface AIEngine {
  processMessage(
    message: string,
    options?: { authToken?: string; userId?: string; history?: ChatMessage[] },
  ): Promise<AIEResponse>
  confirmAndExecute(
    toolName: string,
    params: Record<string, unknown>,
    options?: { authToken?: string; idempotencyKey?: string },
  ): Promise<AIEResponse>
  /** Express handler: (req, res) => Promise<void>. */
  handler(): (req: HandlerRequest, res: HandlerResponse) => Promise<void>
  /** Fastify handler: (request, reply) => Promise<void>. */
  fastifyHandler(): (request: FastifyHandlerRequest, reply: FastifyHandlerReply) => Promise<void>
  /** Hono handler: (c) => Promise<Response>. */
  honoHandler(): (c: HonoContextLike) => Promise<Response>
  /** Framework-agnostic dispatcher — useful when wiring a runtime not covered by the built-in adapters. */
  dispatch(input: { body?: HandlerBody; headers?: Record<string, string | string[] | undefined>; rawRequest?: unknown }): Promise<AIEResponse>
  /** Reload tools.yaml from disk. Atomic — failure leaves the existing registry intact. */
  reload(): Promise<{ ok: true } | { ok: false; error: string }>
  /** Stop background timers (rate-limiter sweep, hot-reload poller). Call on shutdown. */
  dispose(): void
  /** @internal testing only */
  _setProvider(provider: LLMProvider): void
}

/** Body shape every adapter passes into dispatch — matches what engine.handler() reads from req.body. */
export type HandlerBody = {
  message?: string
  userId?: string
  action?: string
  toolName?: string
  params?: Record<string, unknown>
  history?: ChatMessage[]
  idempotencyKey?: string
}

/** Minimal Fastify request / reply shape — kept structural so we don't depend on @fastify/types at compile time. */
export interface FastifyHandlerRequest {
  body?: unknown
  headers?: Record<string, string | string[] | undefined>
}
export interface FastifyHandlerReply {
  send(payload: unknown): unknown
}

/** Minimal Hono Context shape — same idea, structural typing only. */
export interface HonoContextLike {
  req: {
    json(): Promise<unknown>
    header(name: string): string | undefined
  }
  json(payload: unknown): Response
}

export function createAIEngine(config: AIEngineConfig): AIEngine {
  validateAIEngineConfig(config)
  const registry = ToolRegistry.fromFile(config.tools)
  const formatter = new ResponseFormatter()
  const safety = new SafetyGate(registry)
  const executor = new Executor(
    registry,
    config.baseUrl ?? 'http://localhost:3000',
    config.executor?.timeoutMs,
    config.executor?.maxResponseBytes,
  )
  const rateLimiter = new RateLimiter(config.rateLimiting ?? {})
  const idempotency = new IdempotencyStore()
  const logger = new Logger()
  const tracer: TracerLike = config.observability?.tracer ?? NO_OP_TRACER

  // Wrap a function in a tracer span — handles end(), exception recording, and error status uniformly.
  // Graceful AIE error responses (processMessage's outer try/catch returns these) flag the span via
  // an inline span.setStatus call; this helper only catches unexpected throws.
  async function withSpan<T>(name: string, fn: (span: SpanLike) => Promise<T>): Promise<T> {
    const result = tracer.startActiveSpan(name, async (span) => {
      try {
        return await fn(span)
      } catch (err) {
        span.recordException(err)
        span.setStatus({
          code: SpanStatus.ERROR,
          message: err instanceof Error ? err.message : String(err),
        })
        throw err
      } finally {
        span.end()
      }
    })
    return await Promise.resolve(result)
  }
  const messages: Required<MessagesConfig> = { ...DEFAULT_MESSAGES, ...config.messages }

  const maxHistory = config.history?.maxMessages ?? 10
  const maxHistoryTokens = config.history?.maxTokens

  function trimHistory(history: ChatMessage[] | undefined): ChatMessage[] {
    if (!history || history.length === 0) return []
    const byCount = history.length <= maxHistory ? history : history.slice(-maxHistory)
    if (!maxHistoryTokens || maxHistoryTokens <= 0) return byCount

    // Walk backward from most recent and accept messages until token budget is reached.
    // The most recent message is always kept even if it exceeds the cap on its own.
    const kept: ChatMessage[] = []
    let used = 0
    for (let i = byCount.length - 1; i >= 0; i--) {
      const cost = Math.ceil(byCount[i].content.length / 4)
      if (kept.length === 0 || used + cost <= maxHistoryTokens) {
        kept.unshift(byCount[i])
        used += cost
      } else {
        break
      }
    }
    return kept
  }

  // llm is optional — default to Claude with env-driven auth so the minimum config is just `tools`.
  const llmConfig = config.llm ?? { provider: 'claude' as const }

  let provider: LLMProvider
  if (llmConfig.provider === 'custom') {
    if (!llmConfig.instance) {
      throw new Error("LLMConfig.provider='custom' requires LLMConfig.instance — pass an object implementing LLMProvider.")
    }
    provider = llmConfig.instance
  } else if (llmConfig.provider === 'openai-compatible') {
    provider = new OpenAIProvider({
      apiKey: llmConfig.apiKey,
      model: llmConfig.model ?? '',
      baseUrl: llmConfig.baseUrl,
      timeoutMs: llmConfig.timeoutMs,
    })
  } else {
    // 'claude' (default). Pass undefined when apiKey is empty so the Anthropic SDK picks up
    // ANTHROPIC_API_KEY from the environment naturally — saves users a config line.
    provider = new ClaudeProvider(
      llmConfig.apiKey || (undefined as unknown as string),
      llmConfig.model,
      llmConfig.timeoutMs,
    )
  }

  let resolver = new IntentResolver(provider, registry)
  let summarizer = new Summarizer(provider, logger)
  let router = new Router(provider, registry, config.routing)

  function rebuildResolver(): void {
    resolver = new IntentResolver(provider, registry)
    summarizer = new Summarizer(provider, logger)
    router = new Router(provider, registry, config.routing)
  }

  async function processMessage(
    message: string,
    options?: { authToken?: string; userId?: string; history?: ChatMessage[] },
  ): Promise<AIEResponse> {
    return withSpan('aiglue.processMessage', async (span) => {
      setAttr(span, 'aiglue.user_id', options?.userId)
      const result = await processMessageInner(message, options, span)
      setAttr(span, 'aiglue.response_type', result.type)
      if (result.type === 'error') {
        setAttr(span, 'aiglue.error_code', result.code)
        span.setStatus({ code: SpanStatus.ERROR, message: result.code })
      } else {
        span.setStatus({ code: SpanStatus.OK })
      }
      return result
    })
  }

  async function processMessageInner(
    message: string,
    options: { authToken?: string; userId?: string; history?: ChatMessage[] } | undefined,
    span: SpanLike,
  ): Promise<AIEResponse> {
    const startMs = Date.now()
    const rateLimitKey = options?.userId ?? 'global'

    if (!rateLimiter.check(rateLimitKey)) {
      return formatter.formatError(messages.rateLimitedError, 'RATE_LIMIT_EXCEEDED')
    }

    let llmTokensIn = 0
    let llmTokensOut = 0
    let resolvedTool: string | null = null
    let resolvedParams: Record<string, unknown> | null = null

    try {
      const trimmedHistory = trimHistory(options?.history)
      const route = await router.decide(message, trimmedHistory)
      const llmResponse = await resolver.resolve(message, trimmedHistory, route.tools)
      llmTokensIn = llmResponse.tokensIn + route.tokensIn
      llmTokensOut = llmResponse.tokensOut + route.tokensOut

      setAttr(span, 'aiglue.tokens_in', llmTokensIn)
      setAttr(span, 'aiglue.tokens_out', llmTokensOut)
      if (route.fellBack) setAttr(span, 'aiglue.routing_fellback', true)

      if (!llmResponse.toolCall) {
        const textContent = llmResponse.textContent ?? ''
        logger.log({
          timestamp: new Date().toISOString(),
          userId: options?.userId,
          input: message,
          resolvedTool: null,
          params: null,
          latencyMs: Date.now() - startMs,
          llmTokensIn,
          llmTokensOut,
          success: true,
          responseType: 'text',
        })
        return { type: 'text', content: textContent }
      }

      const { toolName, params } = llmResponse.toolCall

      // Clarify meta tool — the LLM is asking the user a follow-up question. Intercept before
      // SafetyGate / Executor: this tool is reserved by the engine and never appears in tools.yaml.
      if (toolName === CLARIFY_META_TOOL) {
        const question = typeof params.question === 'string' ? params.question : ''
        const clarifyOptions = Array.isArray(params.options)
          ? (params.options.filter((o) => typeof o === 'string') as string[])
          : undefined
        const response = formatter.formatClarify(question, clarifyOptions)
        logger.log({
          timestamp: new Date().toISOString(),
          userId: options?.userId,
          input: message,
          resolvedTool: null,
          params: null,
          latencyMs: Date.now() - startMs,
          llmTokensIn,
          llmTokensOut,
          success: true,
          responseType: 'clarify',
        })
        return response
      }

      resolvedTool = toolName
      resolvedParams = params
      const toolDef = registry.getTool(toolName)
      const safeParams = redactParams(resolvedParams, toolDef?.sensitive_params ?? [])

      setAttr(span, 'aiglue.tool_name', toolName)
      setAttr(span, 'aiglue.risk_level', toolDef?.risk_level ?? 'read')

      const safetyResult = safety.check(toolName, params)

      if (!safetyResult.allowed) {
        logger.log({
          timestamp: new Date().toISOString(),
          userId: options?.userId,
          input: message,
          resolvedTool,
          params: safeParams,
          latencyMs: Date.now() - startMs,
          llmTokensIn,
          llmTokensOut,
          success: false,
          responseType: 'error',
          error: safetyResult.reason,
        })
        return formatter.formatError(messages.toolNotAvailableError, 'TOOL_NOT_ALLOWED')
      }

      if (safetyResult.requiresConfirm) {
        const tool = registry.getTool(toolName)!
        const confirmToken = randomUUID()
        logger.log({
          timestamp: new Date().toISOString(),
          userId: options?.userId,
          input: message,
          resolvedTool,
          params: safeParams,
          latencyMs: Date.now() - startMs,
          llmTokensIn,
          llmTokensOut,
          success: true,
          responseType: 'confirm',
        })
        const confirmMsg = tool.confirm_message ?? messages.confirmPrompt(tool.name, params)
        return formatter.formatConfirm(tool, params, confirmMsg, confirmToken)
      }

      const executionResult = await executor.execute(toolName, params, options?.authToken)

      if (executionResult.status >= 400) {
        const internalDetail = `API returned status ${executionResult.status}`
        const errorCode = executionResult.status >= 500 ? 'UPSTREAM_5XX' : 'UPSTREAM_4XX'
        logger.log({
          timestamp: new Date().toISOString(),
          userId: options?.userId,
          input: message,
          resolvedTool,
          params: safeParams,
          latencyMs: Date.now() - startMs,
          llmTokensIn,
          llmTokensOut,
          success: false,
          responseType: 'error',
          error: internalDetail,
        })
        return formatter.formatError(messages.upstreamError, errorCode)
      }

      const tool = registry.getTool(toolName)!
      const base = formatter.format(tool, executionResult.data)
      const response = await summarizer.maybeSummarize(
        tool,
        message,
        executionResult.data,
        base,
      )

      logger.log({
        timestamp: new Date().toISOString(),
        userId: options?.userId,
        input: message,
        resolvedTool,
        params: safeParams,
        latencyMs: Date.now() - startMs,
        llmTokensIn,
        llmTokensOut,
        success: true,
        responseType: response.type,
      })

      return response
    } catch (err) {
      const internalDetail = err instanceof Error ? err.message : String(err)
      logger.error('processMessage failed', err)
      const catchSafeParams = redactParams(resolvedParams, resolvedTool ? (registry.getTool(resolvedTool)?.sensitive_params ?? []) : [])
      logger.log({
        timestamp: new Date().toISOString(),
        userId: options?.userId,
        input: message,
        resolvedTool,
        params: catchSafeParams,
        latencyMs: Date.now() - startMs,
        llmTokensIn,
        llmTokensOut,
        success: false,
        responseType: 'error',
        error: internalDetail,
      })
      return formatter.formatError(messages.internalError, 'INTERNAL_ERROR')
    }
  }

  async function confirmAndExecute(
    toolName: string,
    params: Record<string, unknown>,
    options?: { authToken?: string; idempotencyKey?: string },
  ): Promise<AIEResponse> {
    return withSpan('aiglue.confirmAndExecute', async (span) => {
      setAttr(span, 'aiglue.tool_name', toolName)
      setAttr(span, 'aiglue.idempotency_key_present', !!options?.idempotencyKey)
      const result = await confirmAndExecuteInner(toolName, params, options)
      setAttr(span, 'aiglue.response_type', result.type)
      if (result.type === 'error') {
        setAttr(span, 'aiglue.error_code', result.code)
        span.setStatus({ code: SpanStatus.ERROR, message: result.code })
      } else {
        span.setStatus({ code: SpanStatus.OK })
      }
      return result
    })
  }

  async function confirmAndExecuteInner(
    toolName: string,
    params: Record<string, unknown>,
    options?: { authToken?: string; idempotencyKey?: string },
  ): Promise<AIEResponse> {
    const startMs = Date.now()
    const confirmToolDef = registry.getTool(toolName)
    const confirmSafeParams = redactParams(params, confirmToolDef?.sensitive_params ?? [])

    try {
      if (!registry.hasTool(toolName)) {
        return formatter.formatError(`Tool "${toolName}" not found`, 'TOOL_NOT_FOUND')
      }

      // Idempotency replay — same key within TTL returns the cached response without re-executing.
      if (options?.idempotencyKey) {
        const cached = idempotency.get(options.idempotencyKey)
        if (cached) {
          logger.log({
            timestamp: new Date().toISOString(),
            input: `[confirm:replay] ${toolName}`,
            resolvedTool: toolName,
            params: confirmSafeParams,
            latencyMs: Date.now() - startMs,
            llmTokensIn: 0,
            llmTokensOut: 0,
            success: true,
            responseType: cached.type,
          })
          return cached
        }
      }

      const executionResult = await executor.execute(toolName, params, options?.authToken)

      if (executionResult.status >= 400) {
        const internalDetail = `API returned status ${executionResult.status}`
        const errorCode = executionResult.status >= 500 ? 'UPSTREAM_5XX' : 'UPSTREAM_4XX'
        logger.log({
          timestamp: new Date().toISOString(),
          input: `[confirm] ${toolName}`,
          resolvedTool: toolName,
          params: confirmSafeParams,
          latencyMs: Date.now() - startMs,
          llmTokensIn: 0,
          llmTokensOut: 0,
          success: false,
          responseType: 'error',
          error: internalDetail,
        })
        const errResponse = formatter.formatError(messages.upstreamError, errorCode)
        // Cache deterministic 4xx so the client cannot accidentally re-execute, but skip transient 5xx
        // so a fresh retry with the same idempotencyKey can succeed once the upstream recovers.
        if (options?.idempotencyKey && executionResult.status < 500) {
          idempotency.record(options.idempotencyKey, errResponse)
        }
        return errResponse
      }

      const response = formatter.formatAction(true, messages.actionComplete(toolName))

      if (options?.idempotencyKey) {
        idempotency.record(options.idempotencyKey, response)
      }

      logger.log({
        timestamp: new Date().toISOString(),
        input: `[confirm] ${toolName}`,
        resolvedTool: toolName,
        params: confirmSafeParams,
        latencyMs: Date.now() - startMs,
        llmTokensIn: 0,
        llmTokensOut: 0,
        success: true,
        responseType: response.type,
      })

      return response
    } catch (err) {
      logger.error('confirmAndExecute failed', err)
      return formatter.formatError(messages.internalError, 'INTERNAL_ERROR')
    }
  }

  /** Framework-agnostic dispatcher. Every adapter (Express / Fastify / Hono / custom) funnels through
   *  this so the auth-pickup, confirm-vs-message routing, empty-message guard, and outer error handler
   *  stay in one place. */
  async function dispatch(input: {
    body?: HandlerBody
    headers?: Record<string, string | string[] | undefined>
    /** Optional raw framework request — passed to config.auth.token(req) when configured. */
    rawRequest?: unknown
  }): Promise<AIEResponse> {
    try {
      const body = input.body
      const headers = input.headers ?? {}

      const authToken: string | undefined = (() => {
        if (config.auth?.token) {
          const raw = typeof config.auth.token === 'function'
            ? config.auth.token(input.rawRequest ?? { headers, body })
            : config.auth.token
          return raw || undefined
        }
        const rawAuth = headers.authorization
        const authHeader: string | undefined = Array.isArray(rawAuth) ? rawAuth[0] : rawAuth
        return authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : authHeader
      })()

      if (body?.action === 'confirm') {
        const toolName = body.toolName as string
        const params = body.params as Record<string, unknown>
        return await confirmAndExecute(toolName, params, {
          authToken,
          idempotencyKey: body.idempotencyKey,
        })
      }

      const message = (body?.message ?? '').trim()
      if (!message) {
        return formatter.formatError(messages.emptyMessageError, 'EMPTY_MESSAGE')
      }
      return await processMessage(message, {
        authToken,
        userId: body?.userId,
        history: body?.history,
      })
    } catch (err) {
      logger.error('handler error', err)
      return formatter.formatError(messages.internalError, 'INTERNAL_ERROR')
    }
  }

  function handler(): (req: HandlerRequest, res: HandlerResponse) => Promise<void> {
    return async (req, res) => {
      const result = await dispatch({
        body: req.body,
        headers: req.headers,
        rawRequest: req,
      })
      res.json(result)
    }
  }

  function fastifyHandler(): (request: FastifyHandlerRequest, reply: FastifyHandlerReply) => Promise<void> {
    return async (request, reply) => {
      const result = await dispatch({
        body: request.body as HandlerBody | undefined,
        headers: request.headers,
        rawRequest: request,
      })
      reply.send(result)
    }
  }

  function honoHandler(): (c: HonoContextLike) => Promise<Response> {
    return async (c) => {
      // Hono's context only exposes header() per-name, so we build a minimal lookup. dispatch only
      // reads `authorization`, but we pass the full lookup for completeness.
      const authorization = c.req.header('authorization')
      const headers: Record<string, string | string[] | undefined> = {}
      if (authorization !== undefined) headers.authorization = authorization
      const body = (await c.req.json().catch(() => ({}))) as HandlerBody
      const result = await dispatch({ body, headers, rawRequest: c })
      return c.json(result)
    }
  }

  function _setProvider(newProvider: LLMProvider): void {
    provider = newProvider
    rebuildResolver()
  }

  // Hot reload — polling (B) + explicit engine.reload() (C). The two share the same atomic
  // registry.loadFromFile() path, so both fail safely (existing tools stay live on parse errors).
  let pendingReload: Promise<void> = Promise.resolve()
  let lastMtimeMs: number | null = (() => {
    try {
      return statSync(config.tools).mtimeMs
    } catch {
      return null
    }
  })()

  async function reload(): Promise<{ ok: true } | { ok: false; error: string }> {
    let outcome: { ok: true } | { ok: false; error: string } = { ok: true }
    pendingReload = pendingReload.then(() => {
      try {
        registry.loadFromFile(config.tools)
        try {
          lastMtimeMs = statSync(config.tools).mtimeMs
        } catch {
          // mtime read failure is non-fatal — reload itself succeeded
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        logger.error('tools reload failed', err)
        outcome = { ok: false, error: msg }
      }
    })
    await pendingReload
    return outcome
  }

  const pollIntervalMs = config.hotReload?.pollIntervalMs ?? 0
  let reloadPoller: ReturnType<typeof setInterval> | null = null
  if (pollIntervalMs > 0) {
    reloadPoller = setInterval(() => {
      try {
        const mtime = statSync(config.tools).mtimeMs
        if (lastMtimeMs !== null && mtime !== lastMtimeMs) {
          void reload()
        }
        lastMtimeMs = mtime
      } catch (err) {
        logger.error('tools reload poll failed', err)
      }
    }, pollIntervalMs)
    reloadPoller.unref?.()
  }

  let disposed = false
  let signalHandlers: Array<{ signal: NodeJS.Signals; handler: () => void }> = []

  function dispose(): void {
    if (disposed) return
    disposed = true
    rateLimiter.dispose()
    if (reloadPoller) {
      clearInterval(reloadPoller)
      reloadPoller = null
    }
    for (const { signal, handler } of signalHandlers) {
      process.off(signal, handler)
    }
    signalHandlers = []
  }

  if (config.disposeOnSignal) {
    const onSignal = (): void => dispose()
    for (const signal of ['SIGTERM', 'SIGINT'] as const) {
      process.on(signal, onSignal)
      signalHandlers.push({ signal, handler: onSignal })
    }
  }

  return {
    processMessage,
    confirmAndExecute,
    handler,
    fastifyHandler,
    honoHandler,
    dispatch,
    reload,
    dispose,
    _setProvider,
  }
}

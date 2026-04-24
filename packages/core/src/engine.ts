import { ToolRegistry } from './tool-registry.js'
import { ClaudeProvider } from './providers/claude.js'
import { OpenAIProvider } from './providers/openai.js'
import type { LLMProvider } from './providers/types.js'
import { IntentResolver } from './intent-resolver.js'
import { SafetyGate } from './safety.js'
import { Executor } from './executor.js'
import { ResponseFormatter } from './response-formatter.js'
import { Summarizer } from './summarizer.js'
import { RateLimiter } from './rate-limiter.js'
import { Logger } from './logger.js'
import type { AIEngineConfig, AIEResponse, ChatMessage } from './types.js'

export interface HandlerRequest {
  headers?: Record<string, string | string[] | undefined>
  body?: {
    message?: string
    userId?: string
    action?: string
    toolName?: string
    params?: Record<string, unknown>
    history?: ChatMessage[]
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
    options?: { authToken?: string },
  ): Promise<AIEResponse>
  handler(): (req: HandlerRequest, res: HandlerResponse) => Promise<void>
  /** @internal testing only */
  _setProvider(provider: LLMProvider): void
}

export function createAIEngine(config: AIEngineConfig): AIEngine {
  const registry = ToolRegistry.fromFile(config.tools)
  const formatter = new ResponseFormatter()
  const safety = new SafetyGate(registry)
  const executor = new Executor(registry, config.baseUrl ?? 'http://localhost:3000')
  const rateLimiter = new RateLimiter(config.rateLimiting ?? {})
  const logger = new Logger()

  const maxHistory = config.history?.maxMessages ?? 10

  function trimHistory(history: ChatMessage[] | undefined): ChatMessage[] {
    if (!history || history.length === 0) return []
    if (history.length <= maxHistory) return history
    return history.slice(-maxHistory)
  }

  let provider: LLMProvider
  if (config.llm.provider === 'openai-compatible') {
    provider = new OpenAIProvider({
      apiKey: config.llm.apiKey,
      model: config.llm.model ?? '',
      baseUrl: config.llm.baseUrl,
    })
  } else {
    provider = new ClaudeProvider(config.llm.apiKey ?? '', config.llm.model)
  }

  let resolver = new IntentResolver(provider, registry)
  let summarizer = new Summarizer(provider)

  function rebuildResolver(): void {
    resolver = new IntentResolver(provider, registry)
    summarizer = new Summarizer(provider)
  }

  async function processMessage(
    message: string,
    options?: { authToken?: string; userId?: string; history?: ChatMessage[] },
  ): Promise<AIEResponse> {
    const startMs = Date.now()
    const rateLimitKey = options?.userId ?? 'global'

    if (!rateLimiter.check(rateLimitKey)) {
      return formatter.formatError('Rate limit exceeded', 'RATE_LIMIT_EXCEEDED')
    }

    let llmTokensIn = 0
    let llmTokensOut = 0
    let resolvedTool: string | null = null
    let resolvedParams: Record<string, unknown> | null = null

    try {
      const trimmedHistory = trimHistory(options?.history)
      const llmResponse = await resolver.resolve(message, trimmedHistory)
      llmTokensIn = llmResponse.tokensIn
      llmTokensOut = llmResponse.tokensOut

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
      resolvedTool = toolName
      resolvedParams = params

      const safetyResult = safety.check(toolName, params)

      if (!safetyResult.allowed) {
        logger.log({
          timestamp: new Date().toISOString(),
          userId: options?.userId,
          input: message,
          resolvedTool,
          params: resolvedParams,
          latencyMs: Date.now() - startMs,
          llmTokensIn,
          llmTokensOut,
          success: false,
          responseType: 'error',
          error: safetyResult.reason,
        })
        return formatter.formatError(
          safetyResult.reason ?? 'Tool not allowed',
          'TOOL_NOT_ALLOWED',
        )
      }

      if (safetyResult.requiresConfirm) {
        const tool = registry.getTool(toolName)!
        logger.log({
          timestamp: new Date().toISOString(),
          userId: options?.userId,
          input: message,
          resolvedTool,
          params: resolvedParams,
          latencyMs: Date.now() - startMs,
          llmTokensIn,
          llmTokensOut,
          success: true,
          responseType: 'confirm',
        })
        return formatter.formatConfirm(tool, params)
      }

      const executionResult = await executor.execute(toolName, params, options?.authToken)

      if (executionResult.status >= 400) {
        const errorMsg = `API returned status ${executionResult.status}`
        logger.log({
          timestamp: new Date().toISOString(),
          userId: options?.userId,
          input: message,
          resolvedTool,
          params: resolvedParams,
          latencyMs: Date.now() - startMs,
          llmTokensIn,
          llmTokensOut,
          success: false,
          responseType: 'error',
          error: errorMsg,
        })
        return formatter.formatError(errorMsg, 'API_ERROR')
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
        params: resolvedParams,
        latencyMs: Date.now() - startMs,
        llmTokensIn,
        llmTokensOut,
        success: true,
        responseType: response.type,
      })

      return response
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      logger.error('processMessage failed', err)
      logger.log({
        timestamp: new Date().toISOString(),
        userId: options?.userId,
        input: message,
        resolvedTool,
        params: resolvedParams,
        latencyMs: Date.now() - startMs,
        llmTokensIn,
        llmTokensOut,
        success: false,
        responseType: 'error',
        error: errorMsg,
      })
      return formatter.formatError(errorMsg, 'INTERNAL_ERROR')
    }
  }

  async function confirmAndExecute(
    toolName: string,
    params: Record<string, unknown>,
    options?: { authToken?: string },
  ): Promise<AIEResponse> {
    const startMs = Date.now()

    try {
      if (!registry.hasTool(toolName)) {
        return formatter.formatError(`Tool "${toolName}" not found`, 'TOOL_NOT_FOUND')
      }

      const executionResult = await executor.execute(toolName, params, options?.authToken)

      if (executionResult.status >= 400) {
        const errorMsg = `API returned status ${executionResult.status}`
        logger.log({
          timestamp: new Date().toISOString(),
          input: `[confirm] ${toolName}`,
          resolvedTool: toolName,
          params,
          latencyMs: Date.now() - startMs,
          llmTokensIn: 0,
          llmTokensOut: 0,
          success: false,
          responseType: 'error',
          error: errorMsg,
        })
        return formatter.formatError(errorMsg, 'API_ERROR')
      }

      const response = formatter.formatAction(true, `${toolName} 작업이 완료되었습니다.`)

      logger.log({
        timestamp: new Date().toISOString(),
        input: `[confirm] ${toolName}`,
        resolvedTool: toolName,
        params,
        latencyMs: Date.now() - startMs,
        llmTokensIn: 0,
        llmTokensOut: 0,
        success: true,
        responseType: response.type,
      })

      return response
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      logger.error('confirmAndExecute failed', err)
      return formatter.formatError(errorMsg, 'INTERNAL_ERROR')
    }
  }

  function handler(): (req: HandlerRequest, res: HandlerResponse) => Promise<void> {
    return async (req: HandlerRequest, res: HandlerResponse): Promise<void> => {
      try {
        const rawAuth = req.headers?.authorization
        const authHeader: string | undefined = Array.isArray(rawAuth) ? rawAuth[0] : rawAuth
        const authToken = authHeader?.startsWith('Bearer ')
          ? authHeader.slice(7)
          : authHeader

        if (req.body?.action === 'confirm') {
          const { toolName, params } = req.body as {
            toolName: string
            params: Record<string, unknown>
          }
          const result = await confirmAndExecute(toolName, params, { authToken })
          res.json(result)
          return
        }

        const message: string = req.body?.message ?? ''
        const userId: string | undefined = req.body?.userId
        const history = req.body?.history
        const result = await processMessage(message, { authToken, userId, history })
        res.json(result)
      } catch (err) {
        logger.error('handler error', err)
        res.json(formatter.formatError('Internal server error', 'INTERNAL_ERROR'))
      }
    }
  }

  function _setProvider(newProvider: LLMProvider): void {
    provider = newProvider
    rebuildResolver()
  }

  return {
    processMessage,
    confirmAndExecute,
    handler,
    _setProvider,
  }
}

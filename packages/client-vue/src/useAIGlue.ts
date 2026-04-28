import { ref, shallowRef, type Ref, type ShallowRef } from 'vue'
import type { AIEResponse, ChatMessage } from '@hhowi/aiglue-core'

export interface UseAIGlueOptions {
  /** Endpoint that hosts engine.handler() — typically POST /ai/chat. */
  endpoint: string
  /** Optional fetch overrides (auth headers, credentials, etc.). */
  fetchOptions?: Omit<RequestInit, 'method' | 'body'>
  /** Override the userId sent to the server. The server uses it for rate limiting. */
  userId?: string
  /** Maximum chat history retained client-side. Defaults to 20 — server still trims independently. */
  maxHistory?: number
}

export interface UseAIGlueResult {
  /** Send a user message. Resolves to the engine's structured response. */
  send: (message: string) => Promise<AIEResponse>
  /** Approve a pending confirm. With no args, the composable reuses the last confirm response automatically. */
  sendConfirm: (override?: {
    toolName?: string
    params?: Record<string, unknown>
    idempotencyKey?: string
  }) => Promise<AIEResponse>
  /** Latest engine response, or null before the first call. */
  result: ShallowRef<AIEResponse | null>
  /** Conversation history echoed back on each request. */
  history: Ref<ChatMessage[]>
  /** True while a request is in flight. */
  loading: Ref<boolean>
  /** Network or transport error (HTTP failure, JSON parse error, etc.). NOT set for engine-domain errors;
   *  engine errors arrive as `result.value.type === 'error'`. */
  error: ShallowRef<Error | null>
  /** Wipe history, last result, and any cached confirm state. */
  reset: () => void
}

function assistantContent(resp: AIEResponse): string | undefined {
  if (resp.type === 'text') return resp.content
  if (resp.type === 'summary') return resp.text
  return undefined
}

function trim(history: ChatMessage[], max: number): ChatMessage[] {
  if (history.length <= max) return history
  return history.slice(-max)
}

export function useAIGlue(options: UseAIGlueOptions): UseAIGlueResult {
  const result = shallowRef<AIEResponse | null>(null)
  const history = ref<ChatMessage[]>([])
  const loading = ref(false)
  const error = shallowRef<Error | null>(null)

  // Latest confirmToken — captured from the last 'confirm' response, consumed on the next sendConfirm().
  let confirmToken: string | null = null
  let lastConfirm: { toolName: string; params: Record<string, unknown> } | null = null

  const maxHistory = options.maxHistory ?? 20

  async function post(body: Record<string, unknown>): Promise<AIEResponse> {
    const res = await fetch(options.endpoint, {
      ...options.fetchOptions,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(options.fetchOptions?.headers ?? {}),
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`)
    }
    return (await res.json()) as AIEResponse
  }

  async function send(message: string): Promise<AIEResponse> {
    loading.value = true
    error.value = null
    try {
      const response = await post({
        message,
        userId: options.userId,
        history: history.value,
      })
      if (response.type === 'confirm') {
        confirmToken = response.confirmToken ?? null
        lastConfirm = { toolName: response.toolName, params: response.params }
      }
      const assistant = assistantContent(response)
      const additions: ChatMessage[] = [{ role: 'user', content: message }]
      if (assistant !== undefined) additions.push({ role: 'assistant', content: assistant })
      history.value = trim([...history.value, ...additions], maxHistory)
      result.value = response
      return response
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err))
      error.value = e
      throw e
    } finally {
      loading.value = false
    }
  }

  async function sendConfirm(
    override?: { toolName?: string; params?: Record<string, unknown>; idempotencyKey?: string },
  ): Promise<AIEResponse> {
    const toolName = override?.toolName ?? lastConfirm?.toolName
    const params = override?.params ?? lastConfirm?.params
    if (!toolName || !params) {
      throw new Error(
        'sendConfirm() called without a pending confirm — call send() first or pass { toolName, params } explicitly.',
      )
    }
    const idempotencyKey = override?.idempotencyKey ?? confirmToken ?? undefined

    loading.value = true
    error.value = null
    try {
      const response = await post({
        action: 'confirm',
        toolName,
        params,
        idempotencyKey,
      })
      if (response.type !== 'confirm') {
        confirmToken = null
        lastConfirm = null
      }
      result.value = response
      return response
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err))
      error.value = e
      throw e
    } finally {
      loading.value = false
    }
  }

  function reset(): void {
    confirmToken = null
    lastConfirm = null
    history.value = []
    result.value = null
    error.value = null
  }

  return { send, sendConfirm, result, history, loading, error, reset }
}

import { useCallback, useReducer, useRef } from 'react'
import type { AIEResponse, ChatMessage } from '@aiglue/core'

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
  /** Approve a pending confirm. With no args, the hook reuses the last confirm response automatically. */
  sendConfirm: (override?: {
    toolName?: string
    params?: Record<string, unknown>
    idempotencyKey?: string
  }) => Promise<AIEResponse>
  /** Latest engine response, or null before the first call. */
  result: AIEResponse | null
  /** Conversation history echoed back on each request — survives across send() calls. */
  history: ChatMessage[]
  /** True while a request is in flight. */
  loading: boolean
  /** Network or transport error (HTTP failure, JSON parse error, etc.). NOT set for engine-domain errors;
   *  engine errors arrive as `result.type === 'error'`. */
  error: Error | null
  /** Wipe history, last result, and any cached confirm state. */
  reset: () => void
}

interface State {
  result: AIEResponse | null
  history: ChatMessage[]
  loading: boolean
  error: Error | null
}

type Action =
  | { type: 'request' }
  | { type: 'success'; result: AIEResponse; appendHistory?: { user: string; assistant?: string } }
  | { type: 'failure'; error: Error }
  | { type: 'reset' }

const INITIAL: State = { result: null, history: [], loading: false, error: null }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'request':
      return { ...state, loading: true, error: null }
    case 'success': {
      const next = { ...state, loading: false, result: action.result }
      if (action.appendHistory) {
        const additions: ChatMessage[] = [
          { role: 'user', content: action.appendHistory.user },
        ]
        if (action.appendHistory.assistant !== undefined) {
          additions.push({ role: 'assistant', content: action.appendHistory.assistant })
        }
        next.history = [...state.history, ...additions]
      }
      return next
    }
    case 'failure':
      return { ...state, loading: false, error: action.error }
    case 'reset':
      return INITIAL
  }
}

/** Pulls the assistant-visible text from a response so it can be appended to history.
 *  Only `text` and `summary` carry assistant prose worth round-tripping back to the LLM. */
function assistantContent(resp: AIEResponse): string | undefined {
  if (resp.type === 'text') return resp.content
  if (resp.type === 'summary') return resp.text
  return undefined
}

/** Trims oldest entries when history exceeds the configured cap. */
function trim(history: ChatMessage[], max: number): ChatMessage[] {
  if (history.length <= max) return history
  return history.slice(-max)
}

export function useAIGlue(options: UseAIGlueOptions): UseAIGlueResult {
  const [state, dispatch] = useReducer(reducer, INITIAL)
  // Latest confirmToken — captured from the last 'confirm' response, consumed on the next sendConfirm().
  const confirmTokenRef = useRef<string | null>(null)
  // Latest confirm payload — lets sendConfirm() default to "approve the most recent confirm".
  const lastConfirmRef = useRef<{ toolName: string; params: Record<string, unknown> } | null>(null)
  // Keep a live copy of history for use inside callbacks without re-creating them on every state change.
  const historyRef = useRef<ChatMessage[]>([])
  historyRef.current = state.history

  const maxHistory = options.maxHistory ?? 20

  const post = useCallback(
    async (body: Record<string, unknown>): Promise<AIEResponse> => {
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
    },
    [options.endpoint, options.fetchOptions],
  )

  const send = useCallback(
    async (message: string): Promise<AIEResponse> => {
      dispatch({ type: 'request' })
      try {
        const result = await post({
          message,
          userId: options.userId,
          history: historyRef.current,
        })
        // Capture confirm metadata so sendConfirm() can fire with no arguments.
        if (result.type === 'confirm') {
          confirmTokenRef.current = result.confirmToken ?? null
          lastConfirmRef.current = { toolName: result.toolName, params: result.params }
        }
        const assistant = assistantContent(result)
        const append = { user: message, assistant }
        dispatch({ type: 'success', result, appendHistory: append })
        // Apply client-side trim after the dispatch — reducer-level trim would force every consumer
        // to think about it; doing it here keeps useAIGlue's contract simple.
        if (historyRef.current.length > maxHistory) {
          // Mutating ref is safe — the next dispatch will use the trimmed value.
          historyRef.current = trim([...historyRef.current], maxHistory)
        }
        return result
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))
        dispatch({ type: 'failure', error })
        throw error
      }
    },
    [post, options.userId, maxHistory],
  )

  const sendConfirm = useCallback(
    async (
      override?: { toolName?: string; params?: Record<string, unknown>; idempotencyKey?: string },
    ): Promise<AIEResponse> => {
      const cached = lastConfirmRef.current
      const toolName = override?.toolName ?? cached?.toolName
      const params = override?.params ?? cached?.params
      if (!toolName || !params) {
        throw new Error(
          'sendConfirm() called without a pending confirm — call send() first or pass { toolName, params } explicitly.',
        )
      }
      const idempotencyKey = override?.idempotencyKey ?? confirmTokenRef.current ?? undefined

      dispatch({ type: 'request' })
      try {
        const result = await post({
          action: 'confirm',
          toolName,
          params,
          idempotencyKey,
        })
        // Successful approval clears the pending confirm so a duplicate sendConfirm() does not silently
        // replay the cached idempotencyKey when the user is on a fresh interaction.
        if (result.type !== 'confirm') {
          confirmTokenRef.current = null
          lastConfirmRef.current = null
        }
        dispatch({ type: 'success', result })
        return result
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))
        dispatch({ type: 'failure', error })
        throw error
      }
    },
    [post],
  )

  const reset = useCallback(() => {
    confirmTokenRef.current = null
    lastConfirmRef.current = null
    historyRef.current = []
    dispatch({ type: 'reset' })
  }, [])

  return {
    send,
    sendConfirm,
    result: state.result,
    history: state.history,
    loading: state.loading,
    error: state.error,
    reset,
  }
}

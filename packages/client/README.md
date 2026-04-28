# @aiglue/client

Headless React hook for the [`@aiglue/core`](../core/README.md) `/ai/chat` endpoint. Owns the boilerplate every aiglue frontend used to repeat — confirm-token echo, multi-turn history, transport vs engine error split — and stays out of your UI's way.

## Install

```bash
npm install @aiglue/client @aiglue/core
# react 18 or 19 is a peer dep
```

## Use

```tsx
import { useAIGlue } from '@aiglue/client'

export function Chat() {
  const { send, sendConfirm, result, history, loading, error, reset } = useAIGlue({
    endpoint: '/ai/chat',
  })

  return (
    <>
      <input
        disabled={loading}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            send((e.target as HTMLInputElement).value)
            ;(e.target as HTMLInputElement).value = ''
          }
        }}
      />

      {loading && <p>…</p>}
      {error && <p>Network error: {error.message}</p>}

      {result?.type === 'text' && <p>{result.content}</p>}
      {result?.type === 'table' && <YourTable columns={result.columns} rows={result.rows} />}
      {result?.type === 'summary' && <p>{result.text}</p>}
      {result?.type === 'action' && <p>✓ {result.message}</p>}
      {result?.type === 'error' && <p>Error ({result.code}): {result.message}</p>}

      {result?.type === 'confirm' && (
        <dialog open>
          <p>{result.message}</p>
          {/* sendConfirm() with no args echoes the captured confirmToken automatically */}
          <button onClick={() => sendConfirm()}>Confirm</button>
          <button onClick={reset}>Cancel</button>
        </dialog>
      )}
    </>
  )
}
```

## API

```ts
useAIGlue(options: {
  endpoint: string
  fetchOptions?: Omit<RequestInit, 'method' | 'body'>
  userId?: string
  maxHistory?: number  // default 20
}): {
  send(message: string): Promise<AIEResponse>
  sendConfirm(override?: { toolName?, params?, idempotencyKey? }): Promise<AIEResponse>
  result: AIEResponse | null
  history: ChatMessage[]
  loading: boolean
  error: Error | null
  reset(): void
}
```

### Behavior worth knowing

- **Confirm idempotency** is automatic. The hook captures `confirmToken` from a `type: 'confirm'` response and echoes it as `idempotencyKey` the next time you call `sendConfirm()`. Click the confirm button twice and your write only fires once.
- **History is auto-relayed** to the server on every `send()` so multi-turn intent works (`"지난주는?"`, clarify follow-ups). Capped at `maxHistory` messages (default 20). Server still trims independently.
- **Transport errors vs engine errors are separate.** `error` is set only for HTTP / parse failures. Engine-domain errors (rate limit, upstream 4xx/5xx, internal) arrive as `result.type === 'error'` with a stable `code` field — branch on the code.
- **`reset()`** clears history, the last result, the cached confirm, and the error. Use it on logout or when starting a fresh conversation.

## What this hook does NOT do

- No rendered UI components. Renderers per response type stay yours.
- No Vue / Svelte adapters yet. The internals would port easily — open an issue if you need it.
- No streaming. Engine itself is non-streaming today; will revisit when the engine surface changes.

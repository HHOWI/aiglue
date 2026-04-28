import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { nextTick } from 'vue'
import { useAIGlue } from '../src/useAIGlue.js'

const ENDPOINT = '/ai/chat'

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  ;(globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch
})

afterEach(() => {
  vi.restoreAllMocks()
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('useAIGlue (Vue) — send()', () => {
  it('returns the engine response and accumulates user/assistant turns into history', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ type: 'text', content: '안녕하세요' }))

    const { send, result, history, loading, error } = useAIGlue({ endpoint: ENDPOINT })

    const response = await send('hi')
    await nextTick()

    expect(response).toEqual({ type: 'text', content: '안녕하세요' })
    expect(result.value).toEqual({ type: 'text', content: '안녕하세요' })
    expect(history.value).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '안녕하세요' },
    ])
    expect(loading.value).toBe(false)
    expect(error.value).toBeNull()
  })

  it('replays history on subsequent send() calls', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ type: 'text', content: '안녕' }))
      .mockResolvedValueOnce(jsonResponse({ type: 'text', content: '네' }))

    const { send } = useAIGlue({ endpoint: ENDPOINT })
    await send('hi')
    await send('again')

    const secondCallBody = JSON.parse(fetchMock.mock.calls[1][1].body as string)
    expect(secondCallBody.history).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '안녕' },
    ])
  })

  it('does not append assistant turns for table / action / confirm response types', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ type: 'table', columns: [], rows: [] }))
    const { send, history } = useAIGlue({ endpoint: ENDPOINT })
    await send('list')
    expect(history.value).toEqual([{ role: 'user', content: 'list' }])
  })

  it('flips loading flag while a request is in flight', async () => {
    let resolveFetch: (r: Response) => void = () => {}
    fetchMock.mockReturnValueOnce(new Promise<Response>((r) => { resolveFetch = r }))

    const { send, loading } = useAIGlue({ endpoint: ENDPOINT })
    const pending = send('hi')
    await nextTick()
    expect(loading.value).toBe(true)

    resolveFetch(jsonResponse({ type: 'text', content: 'ok' }))
    await pending
    expect(loading.value).toBe(false)
  })

  it('captures network failures into error.value and rethrows', async () => {
    fetchMock.mockResolvedValueOnce(new Response('boom', { status: 500, statusText: 'Internal' }))

    const { send, error, loading } = useAIGlue({ endpoint: ENDPOINT })
    await expect(send('hi')).rejects.toThrow(/HTTP 500/)
    expect(error.value).toBeInstanceOf(Error)
    expect(loading.value).toBe(false)
  })
})

describe('useAIGlue (Vue) — sendConfirm()', () => {
  it('echoes the confirmToken from the previous confirm response automatically', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          type: 'confirm',
          message: 'really?',
          toolName: 'delete_user',
          params: { id: '42' },
          confirmToken: 'token-abc',
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ type: 'action', status: 'success', message: 'done' }))

    const { send, sendConfirm, result } = useAIGlue({ endpoint: ENDPOINT })
    await send('delete user 42')
    await sendConfirm()

    const confirmBody = JSON.parse(fetchMock.mock.calls[1][1].body as string)
    expect(confirmBody).toEqual({
      action: 'confirm',
      toolName: 'delete_user',
      params: { id: '42' },
      idempotencyKey: 'token-abc',
    })
    expect((result.value as { type: string }).type).toBe('action')
  })

  it('throws when no pending confirm and no override', async () => {
    const { sendConfirm } = useAIGlue({ endpoint: ENDPOINT })
    await expect(sendConfirm()).rejects.toThrow(/without a pending confirm/)
  })
})

describe('useAIGlue (Vue) — reset()', () => {
  it('wipes history, result, error, and the cached confirm', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        type: 'confirm',
        message: 'really?',
        toolName: 'x',
        params: {},
        confirmToken: 't',
      }),
    )
    const { send, reset, history, result, sendConfirm } = useAIGlue({ endpoint: ENDPOINT })
    await send('hi')
    expect(history.value.length).toBeGreaterThan(0)

    reset()
    expect(history.value).toEqual([])
    expect(result.value).toBeNull()
    await expect(sendConfirm()).rejects.toThrow(/without a pending confirm/)
  })
})

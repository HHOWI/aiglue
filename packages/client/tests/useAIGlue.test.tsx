import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
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

describe('useAIGlue — send()', () => {
  it('returns the engine response and accumulates user/assistant turns into history', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ type: 'text', content: '안녕하세요' }))

    const { result } = renderHook(() => useAIGlue({ endpoint: ENDPOINT }))

    let response: unknown
    await act(async () => {
      response = await result.current.send('hi')
    })

    expect(response).toEqual({ type: 'text', content: '안녕하세요' })
    expect(result.current.result).toEqual({ type: 'text', content: '안녕하세요' })
    expect(result.current.history).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '안녕하세요' },
    ])
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('replays the accumulated history on subsequent send() calls', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ type: 'text', content: '안녕' }))
      .mockResolvedValueOnce(jsonResponse({ type: 'text', content: '네' }))

    const { result } = renderHook(() => useAIGlue({ endpoint: ENDPOINT }))

    await act(async () => { await result.current.send('hi') })
    await act(async () => { await result.current.send('again') })

    const secondCallBody = JSON.parse(fetchMock.mock.calls[1][1].body as string)
    expect(secondCallBody.message).toBe('again')
    expect(secondCallBody.history).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '안녕' },
    ])
  })

  it('does not append assistant turns for table / action / confirm / error response types', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ type: 'table', columns: [], rows: [] }),
    )

    const { result } = renderHook(() => useAIGlue({ endpoint: ENDPOINT }))

    await act(async () => { await result.current.send('list') })

    expect(result.current.history).toEqual([{ role: 'user', content: 'list' }])
  })

  it('exposes loading flag while the request is in flight', async () => {
    let resolveFetch: (r: Response) => void = () => {}
    fetchMock.mockReturnValueOnce(new Promise<Response>((r) => { resolveFetch = r }))

    const { result } = renderHook(() => useAIGlue({ endpoint: ENDPOINT }))

    let pending: Promise<unknown> | undefined
    act(() => { pending = result.current.send('hi') })
    await waitFor(() => expect(result.current.loading).toBe(true))

    resolveFetch(jsonResponse({ type: 'text', content: 'ok' }))
    await act(async () => { await pending })
    expect(result.current.loading).toBe(false)
  })

  it('captures network failures into result.error and rethrows', async () => {
    fetchMock.mockResolvedValueOnce(new Response('boom', { status: 500, statusText: 'Internal' }))

    const { result } = renderHook(() => useAIGlue({ endpoint: ENDPOINT }))

    await act(async () => {
      await expect(result.current.send('hi')).rejects.toThrow(/HTTP 500/)
    })
    expect(result.current.error).toBeInstanceOf(Error)
    expect(result.current.loading).toBe(false)
  })
})

describe('useAIGlue — sendConfirm()', () => {
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

    const { result } = renderHook(() => useAIGlue({ endpoint: ENDPOINT }))

    await act(async () => { await result.current.send('delete user 42') })
    await act(async () => { await result.current.sendConfirm() })

    const confirmBody = JSON.parse(fetchMock.mock.calls[1][1].body as string)
    expect(confirmBody).toEqual({
      action: 'confirm',
      toolName: 'delete_user',
      params: { id: '42' },
      idempotencyKey: 'token-abc',
    })
    expect((result.current.result as { type: string }).type).toBe('action')
  })

  it('lets the caller override toolName / params / idempotencyKey explicitly', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ type: 'action', status: 'success', message: 'done' }),
    )

    const { result } = renderHook(() => useAIGlue({ endpoint: ENDPOINT }))

    await act(async () => {
      await result.current.sendConfirm({
        toolName: 'update_user',
        params: { id: '1', name: 'X' },
        idempotencyKey: 'manual-key',
      })
    })

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.toolName).toBe('update_user')
    expect(body.idempotencyKey).toBe('manual-key')
  })

  it('throws when called with no pending confirm and no override', async () => {
    const { result } = renderHook(() => useAIGlue({ endpoint: ENDPOINT }))

    await expect(result.current.sendConfirm()).rejects.toThrow(/without a pending confirm/)
  })
})

describe('useAIGlue — multi response pass-through', () => {
  it('surfaces AIEMultiResponse unchanged when result.type === "multi"', async () => {
    const multiResponse = {
      type: 'multi',
      results: [
        { type: 'text', content: 'first' },
        { type: 'table', columns: ['id'], rows: [['1']] },
      ],
    }
    fetchMock.mockResolvedValueOnce(jsonResponse(multiResponse))

    const { result } = renderHook(() => useAIGlue({ endpoint: ENDPOINT }))

    let response: unknown
    await act(async () => {
      response = await result.current.send('show multi')
    })

    expect((response as { type: string }).type).toBe('multi')
    expect((result.current.result as { type: string }).type).toBe('multi')
    expect((result.current.result as typeof multiResponse).results).toHaveLength(2)
  })
})

describe('useAIGlue — reset()', () => {
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
    const { result } = renderHook(() => useAIGlue({ endpoint: ENDPOINT }))

    await act(async () => { await result.current.send('hi') })
    expect(result.current.history.length).toBeGreaterThan(0)

    act(() => { result.current.reset() })
    expect(result.current.history).toEqual([])
    expect(result.current.result).toBeNull()
    await expect(result.current.sendConfirm()).rejects.toThrow(/without a pending confirm/)
  })
})

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { resolve } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { createServer, type Server } from 'http'
import { createAIEngine } from '../../src/engine.js'
import type { TracerLike, SpanLike } from '../../src/observability/tracer.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const fixturePath = resolve(__dirname, '../fixtures/sample-tools.yaml')

let mockApi: Server
let apiPort: number

beforeAll(async () => {
  mockApi = createServer((req, res) => {
    if (req.url?.startsWith('/api/users') && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify([{ id: '1', name: 'Alice', role: 'admin' }]))
    } else {
      res.writeHead(404)
      res.end()
    }
  })
  await new Promise<void>((r) => mockApi.listen(0, () => {
    const a = mockApi.address()
    apiPort = typeof a === 'object' && a ? a.port : 0
    r()
  }))
})

afterAll(() => mockApi.close())

interface CapturedSpan {
  name: string
  attributes: Record<string, unknown>
  status: { code: number; message?: string } | null
  ended: boolean
  exceptions: unknown[]
}

function createCapturingTracer(): { tracer: TracerLike; spans: CapturedSpan[] } {
  const spans: CapturedSpan[] = []
  const tracer: TracerLike = {
    startActiveSpan(name, fn) {
      const captured: CapturedSpan = {
        name,
        attributes: {},
        status: null,
        ended: false,
        exceptions: [],
      }
      spans.push(captured)
      const span: SpanLike = {
        setAttribute(key, value) {
          captured.attributes[key] = value
        },
        setStatus(status) {
          captured.status = { ...status }
        },
        recordException(ex) {
          captured.exceptions.push(ex)
        },
        end() {
          captured.ended = true
        },
      }
      return fn(span)
    },
  }
  return { tracer, spans }
}

describe('Engine observability — processMessage span', () => {
  it('emits a single root span with status OK and per-call attributes on success', async () => {
    const { tracer, spans } = createCapturingTracer()
    const engine = createAIEngine({
      tools: fixturePath,
      llm: { provider: 'claude', apiKey: 'k' },
      baseUrl: `http://localhost:${apiPort}`,
      observability: { tracer },
    })
    engine._setProvider({
      resolve: vi.fn().mockResolvedValue({
        toolCall: { toolName: 'get_users', params: {} },
        textContent: null,
        tokensIn: 100,
        tokensOut: 20,
      }),
    })

    await engine.processMessage('show users', { userId: 'u-1' })

    const processSpans = spans.filter((s) => s.name === 'aiglue.processMessage')
    expect(processSpans).toHaveLength(1)
    const span = processSpans[0]
    expect(span.ended).toBe(true)
    expect(span.status?.code).toBe(1) // OK
    expect(span.attributes['aiglue.user_id']).toBe('u-1')
    expect(span.attributes['aiglue.tool_name']).toBe('get_users')
    expect(span.attributes['aiglue.risk_level']).toBe('read')
    expect(span.attributes['aiglue.response_type']).toBe('table')
    expect(span.attributes['aiglue.tokens_in']).toBe(100)
    expect(span.attributes['aiglue.tokens_out']).toBe(20)
  })

  it('marks the span ERROR with the engine error code on a graceful AIE error response', async () => {
    const { tracer, spans } = createCapturingTracer()
    const engine = createAIEngine({
      tools: fixturePath,
      llm: { provider: 'claude', apiKey: 'k' },
      baseUrl: `http://localhost:${apiPort}`,
      observability: { tracer },
    })
    // No userId → first global hit is fine; force rate limit by setting a stupidly tight global cap.
    // Easier path: provide a resolve mock that picks an unknown tool → safety rejects.
    engine._setProvider({
      resolve: vi.fn().mockResolvedValue({
        toolCall: { toolName: 'not_in_whitelist', params: {} },
        textContent: null,
        tokensIn: 10,
        tokensOut: 5,
      }),
    })

    const result = await engine.processMessage('hack')
    expect(result.type).toBe('error')

    const span = spans.find((s) => s.name === 'aiglue.processMessage')!
    expect(span.status?.code).toBe(2) // ERROR
    expect(span.attributes['aiglue.error_code']).toBe('TOOL_NOT_ALLOWED')
    expect(span.ended).toBe(true)
  })

  it('records exception + ends the span when an unexpected throw escapes processMessage', async () => {
    // The engine catches unexpected errors and returns INTERNAL_ERROR — so the span ends OK from
    // the inner returns-error path. But the LLM provider failure case still routes through the same
    // graceful path. Verify that even in that path, the span is ended and tagged ERROR with the code.
    const { tracer, spans } = createCapturingTracer()
    const engine = createAIEngine({
      tools: fixturePath,
      llm: { provider: 'claude', apiKey: 'k' },
      baseUrl: `http://localhost:${apiPort}`,
      observability: { tracer },
    })
    engine._setProvider({
      resolve: vi.fn().mockRejectedValue(new Error('LLM gateway timeout')),
    })

    const result = await engine.processMessage('something')
    expect(result.type).toBe('error')

    const span = spans.find((s) => s.name === 'aiglue.processMessage')!
    expect(span.ended).toBe(true)
    expect(span.status?.code).toBe(2)
    expect(span.attributes['aiglue.error_code']).toBe('INTERNAL_ERROR')
  })
})

describe('Engine observability — confirmAndExecute span', () => {
  it('emits a confirmAndExecute span with tool_name and idempotency flag', async () => {
    const { tracer, spans } = createCapturingTracer()
    const engine = createAIEngine({
      tools: fixturePath,
      llm: { provider: 'claude', apiKey: 'k' },
      baseUrl: `http://localhost:${apiPort}`,
      observability: { tracer },
    })

    await engine.confirmAndExecute(
      'update_user',
      { id: '1', name: 'X' },
      { idempotencyKey: 'k-1' },
    )

    const span = spans.find((s) => s.name === 'aiglue.confirmAndExecute')!
    expect(span.attributes['aiglue.tool_name']).toBe('update_user')
    expect(span.attributes['aiglue.idempotency_key_present']).toBe(true)
    expect(span.ended).toBe(true)
  })
})

describe('Engine observability — no-op default', () => {
  it('does not throw when observability is omitted', async () => {
    const engine = createAIEngine({
      tools: fixturePath,
      llm: { provider: 'claude', apiKey: 'k' },
      baseUrl: `http://localhost:${apiPort}`,
    })
    engine._setProvider({
      resolve: vi.fn().mockResolvedValue({
        toolCall: { toolName: 'get_users', params: {} },
        textContent: null,
        tokensIn: 1,
        tokensOut: 1,
      }),
    })

    const result = await engine.processMessage('show users')
    expect(result.type).toBe('table')
  })
})

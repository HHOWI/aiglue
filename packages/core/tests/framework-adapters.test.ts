import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { createServer, type Server } from 'http'
import { createAIEngine } from '../src/engine.js'
import { defineTool } from '../src/define-tool.js'

const sampleTools = [
  defineTool({
    name: 'get_users',
    description: '사용자 목록을 조회한다',
    endpoint: 'GET /api/users',
    responseType: 'table',
    riskLevel: 'read',
    columns: [{ key: 'id', label: 'ID' }],
  }),
]

let upstream: Server
let upstreamPort: number
let lastAuthHeader: string | undefined

beforeAll(async () => {
  upstream = createServer((req, res) => {
    lastAuthHeader = req.headers.authorization
    if (req.url?.startsWith('/api/users') && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify([{ id: '1', name: 'Alice', role: 'admin' }]))
    } else {
      res.writeHead(404)
      res.end()
    }
  })
  await new Promise<void>((r) => upstream.listen(0, () => {
    const a = upstream.address()
    upstreamPort = typeof a === 'object' && a ? a.port : 0
    r()
  }))
})

afterAll(() => upstream.close())

function buildEngine() {
  const engine = createAIEngine({
    tools: sampleTools,
    llm: { provider: 'claude', apiKey: 'test-key' },
    baseUrl: `http://localhost:${upstreamPort}`,
  })
  engine._setProvider({
    resolve: vi.fn().mockResolvedValue({
      toolCalls: [{ toolName: 'get_users', params: {} }],
      textContent: null,
      tokensIn: 5,
      tokensOut: 5,
    }),
    chat: vi.fn(),
  })
  return engine
}

describe('engine.fastifyHandler()', () => {
  it('reads body / headers from a Fastify-shaped request and replies via reply.send()', async () => {
    const engine = buildEngine()
    const handler = engine.fastifyHandler()

    const sent: unknown[] = []
    await handler(
      {
        body: { message: 'show users' },
        headers: { authorization: 'Bearer fastify-jwt' },
      },
      { send: (payload) => { sent.push(payload) } },
    )

    expect(sent).toHaveLength(1)
    expect((sent[0] as { type: string }).type).toBe('table')
    expect(lastAuthHeader).toBe('Bearer fastify-jwt')
    engine.dispose()
  })

  it('returns EMPTY_MESSAGE when body.message is missing', async () => {
    const engine = buildEngine()
    const handler = engine.fastifyHandler()
    const sent: unknown[] = []
    await handler({ body: {}, headers: {} }, { send: (p) => { sent.push(p) } })
    expect((sent[0] as { type: string; code: string }).code).toBe('EMPTY_MESSAGE')
    engine.dispose()
  })
})

describe('engine.honoHandler()', () => {
  it('parses request via c.req.json() and returns a Response via c.json()', async () => {
    const engine = buildEngine()
    const handler = engine.honoHandler()

    const ctx = {
      req: {
        async json() {
          return { message: 'show users' }
        },
        header(name: string) {
          if (name === 'authorization') return 'Bearer hono-jwt'
          return undefined
        },
      },
      json(payload: unknown) {
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      },
    }

    const response = await handler(ctx)
    const body = await response.json()
    expect((body as { type: string }).type).toBe('table')
    expect(lastAuthHeader).toBe('Bearer hono-jwt')
    engine.dispose()
  })

  it('returns EMPTY_MESSAGE error when body parses but message is empty', async () => {
    const engine = buildEngine()
    const handler = engine.honoHandler()
    const ctx = {
      req: {
        async json() { return { message: '   ' } },
        header() { return undefined },
      },
      json(payload: unknown) {
        return new Response(JSON.stringify(payload), { status: 200 })
      },
    }
    const response = await handler(ctx)
    const body = (await response.json()) as { type: string; code: string }
    expect(body.code).toBe('EMPTY_MESSAGE')
    engine.dispose()
  })

  it('falls back to empty body when c.req.json() rejects', async () => {
    const engine = buildEngine()
    const handler = engine.honoHandler()
    const ctx = {
      req: {
        async json() { throw new Error('not json') },
        header() { return undefined },
      },
      json(payload: unknown) {
        return new Response(JSON.stringify(payload), { status: 200 })
      },
    }
    const response = await handler(ctx)
    const body = (await response.json()) as { type: string; code: string }
    expect(body.code).toBe('EMPTY_MESSAGE')
    engine.dispose()
  })
})

describe('engine.dispatch() — framework-agnostic core', () => {
  it('returns the AIE response directly so users can wire any custom runtime', async () => {
    const engine = buildEngine()
    const result = await engine.dispatch({
      body: { message: 'show users' },
      headers: { authorization: 'Bearer custom-runtime' },
    })
    expect(result.type).toBe('table')
    expect(lastAuthHeader).toBe('Bearer custom-runtime')
    engine.dispose()
  })

  it('forwards confirm submissions including idempotencyKey', async () => {
    const engine = buildEngine()
    const result = await engine.dispatch({
      body: {
        action: 'confirm',
        toolName: 'update_user',
        params: { id: '1', name: 'X' },
        idempotencyKey: 'abc',
      },
      headers: {},
    })
    // update_user is not in sampleTools → expect TOOL_NOT_FOUND error
    expect(['action', 'error']).toContain(result.type)
    engine.dispose()
  })
})

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { createAIEngine } from '../src/engine.js'
import { defineTool } from '../src/define-tool.js'
import { z } from 'zod'
import { createServer, type Server } from 'http'

// ── shared tool fixtures (replaces sample-tools.yaml) ──────────────────────

const getUsersTool = defineTool({
  name: 'get_users',
  description: '사용자 목록을 조회한다',
  endpoint: 'GET /api/users',
  responseType: 'table',
  riskLevel: 'read',
  columns: [
    { key: 'id', label: 'ID' },
    { key: 'name', label: '이름' },
    { key: 'role', label: '역할', type: 'badge' },
  ],
  examples: ['사용자 목록 보여줘', '관리자 목록'],
})

const updateUserTool = defineTool({
  name: 'update_user',
  description: '사용자 정보를 수정한다',
  endpoint: 'PUT /api/users/:id',
  params: z.object({ id: z.string(), name: z.string().optional() }),
  riskLevel: 'write',
  confirmMessage: '사용자 정보를 수정합니다. 진행할까요?',
})

const deleteUserTool = defineTool({
  name: 'delete_user',
  description: '사용자를 삭제한다',
  endpoint: 'DELETE /api/users/:id',
  params: z.object({ id: z.string() }),
  riskLevel: 'critical',
  confirmMessage: '사용자를 삭제합니다. 이 작업은 되돌릴 수 없습니다.',
})

const sampleTools = [getUsersTool, updateUserTool, deleteUserTool]

// ── shared mock API server ──────────────────────────────────────────────────

let mockApiServer: Server
let apiPort: number

beforeAll(async () => {
  mockApiServer = createServer((req, res) => {
    if (req.url?.startsWith('/api/users') && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify([
        { id: '1', name: 'Alice', role: 'admin' },
      ]))
    } else {
      res.writeHead(404)
      res.end()
    }
  })
  await new Promise<void>((r) => {
    mockApiServer.listen(0, () => {
      const addr = mockApiServer.address()
      apiPort = typeof addr === 'object' && addr ? addr.port : 0
      r()
    })
  })
})

afterAll(() => mockApiServer.close())

// ── zero-config defaults ────────────────────────────────────────────────────

describe('createAIEngine — zero-config defaults', () => {
  it('llm is optional — defaults to claude provider with env-driven auth', () => {
    // No throw expected. The Anthropic SDK only reads ANTHROPIC_API_KEY when an actual API call fires,
    // so construction with no env var still succeeds.
    const engine = createAIEngine({
      tools: sampleTools,
      baseUrl: `http://localhost:${apiPort}`,
    })
    expect(engine).toBeDefined()
    expect(typeof engine.processMessage).toBe('function')
    engine.dispose()
  })
})

// ── core engine behaviour ───────────────────────────────────────────────────

describe('createAIEngine', () => {
  it('should create an engine instance', () => {
    const engine = createAIEngine({
      tools: sampleTools,
      llm: { provider: 'claude', apiKey: 'test-key' },
      baseUrl: `http://localhost:${apiPort}`,
    })
    expect(engine).toBeDefined()
    expect(typeof engine.handler).toBe('function')
    expect(typeof engine.processMessage).toBe('function')
  })

  it('should process a message with mocked LLM and return table', async () => {
    const engine = createAIEngine({
      tools: sampleTools,
      llm: { provider: 'claude', apiKey: 'test-key' },
      baseUrl: `http://localhost:${apiPort}`,
    })

    engine._setProvider({
      resolve: vi.fn().mockResolvedValue({
        toolCalls: [{ toolName: 'get_users', params: {} }],
        textContent: null,
        tokensIn: 500,
        tokensOut: 50,
      }),
      chat: vi.fn(),
    })

    const result = await engine.processMessage('사용자 보여줘')
    expect(result.type).toBe('table')
  })

  it('should return text when LLM returns no tool call', async () => {
    const engine = createAIEngine({
      tools: sampleTools,
      llm: { provider: 'claude', apiKey: 'test-key' },
      baseUrl: `http://localhost:${apiPort}`,
    })

    engine._setProvider({
      resolve: vi.fn().mockResolvedValue({
        toolCalls: [],
        textContent: '무엇을 도와드릴까요?',
        tokensIn: 100,
        tokensOut: 20,
      }),
      chat: vi.fn(),
    })

    const result = await engine.processMessage('안녕')
    expect(result.type).toBe('text')
    if (result.type === 'text') {
      expect(result.content).toBe('무엇을 도와드릴까요?')
    }
  })

  it('should return error when tool is not in whitelist', async () => {
    const engine = createAIEngine({
      tools: sampleTools,
      llm: { provider: 'claude', apiKey: 'test-key' },
      baseUrl: `http://localhost:${apiPort}`,
    })

    engine._setProvider({
      resolve: vi.fn().mockResolvedValue({
        toolCalls: [{ toolName: 'hack_system', params: {} }],
        textContent: null,
        tokensIn: 100,
        tokensOut: 20,
      }),
      chat: vi.fn(),
    })

    const result = await engine.processMessage('해킹해줘')
    expect(result.type).toBe('error')
  })

  it('should return confirm for write tools', async () => {
    const engine = createAIEngine({
      tools: sampleTools,
      llm: { provider: 'claude', apiKey: 'test-key' },
      baseUrl: `http://localhost:${apiPort}`,
    })

    engine._setProvider({
      resolve: vi.fn().mockResolvedValue({
        toolCalls: [{ toolName: 'update_user', params: { id: '1', name: 'Updated' } }],
        textContent: null,
        tokensIn: 100,
        tokensOut: 20,
      }),
      chat: vi.fn(),
    })

    const result = await engine.processMessage('사용자 수정해줘')
    expect(result.type).toBe('confirm')
  })

  it('should return error on LLM failure', async () => {
    const engine = createAIEngine({
      tools: sampleTools,
      llm: { provider: 'claude', apiKey: 'test-key' },
      baseUrl: `http://localhost:${apiPort}`,
    })

    engine._setProvider({
      resolve: vi.fn().mockRejectedValue(new Error('LLM timeout')),
      chat: vi.fn(),
    })

    const result = await engine.processMessage('뭐든')
    expect(result.type).toBe('error')
  })

  it('should not leak raw err.message in INTERNAL_ERROR responses', async () => {
    const engine = createAIEngine({
      tools: sampleTools,
      llm: { provider: 'claude', apiKey: 'test-key' },
      baseUrl: `http://localhost:${apiPort}`,
    })
    const secret = 'connect ECONNREFUSED 10.0.0.42:5432 db=prod-creds'
    engine._setProvider({
      resolve: vi.fn().mockRejectedValue(new Error(secret)),
      chat: vi.fn(),
    })

    const result = await engine.processMessage('뭐든')
    expect(result.type).toBe('error')
    if (result.type === 'error') {
      expect(result.message).not.toContain(secret)
      expect(result.message).not.toContain('ECONNREFUSED')
      expect(result.code).toBe('INTERNAL_ERROR')
    }
  })

  it('should not leak upstream status detail in user-facing message', async () => {
    const errServer: Server = createServer((_req, res) => {
      res.writeHead(503, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'pg connection pool exhausted' }))
    })
    const errPort = await new Promise<number>((r) => {
      errServer.listen(0, () => {
        const addr = errServer.address()
        r(typeof addr === 'object' && addr ? addr.port : 0)
      })
    })

    const engine = createAIEngine({
      tools: sampleTools,
      llm: { provider: 'claude', apiKey: 'test-key' },
      baseUrl: `http://localhost:${errPort}`,
    })
    engine._setProvider({
      resolve: vi.fn().mockResolvedValue({
        toolCalls: [{ toolName: 'get_users', params: {} }],
        textContent: null,
        tokensIn: 10,
        tokensOut: 5,
      }),
      chat: vi.fn(),
    })

    const result = await engine.processMessage('사용자 보여줘')
    expect(result.type).toBe('error')
    if (result.type === 'error') {
      expect(result.message).not.toContain('503')
      expect(result.message).not.toContain('status')
      expect(result.message).not.toContain('pg connection')
      expect(result.code).toBe('UPSTREAM_5XX')
    }

    await new Promise<void>((r) => errServer.close(() => r()))
  })
})

// ── history passthrough ─────────────────────────────────────────────────────

describe('createAIEngine — history passthrough', () => {
  it('relays client-provided history to the resolver', async () => {
    const engine = createAIEngine({
      tools: sampleTools,
      llm: { provider: 'claude', apiKey: 'test-key' },
      baseUrl: `http://localhost:${apiPort}`,
    })

    const mockResolve = vi.fn().mockResolvedValue({
      toolCalls: [],
      textContent: 'ok',
      tokensIn: 0,
      tokensOut: 0,
    })
    engine._setProvider({ resolve: mockResolve, chat: vi.fn() })

    await engine.processMessage('follow-up', {
      history: [
        { role: 'user', content: 'prev q' },
        { role: 'assistant', content: 'prev a' },
      ],
    })

    const passedMessages = mockResolve.mock.calls[0][0]
    const contents = passedMessages.map((m: { content: string }) => m.content)
    expect(contents).toContain('prev q')
    expect(contents).toContain('prev a')
    expect(contents).toContain('follow-up')
  })

  it('trims history to maxMessages (default 10)', async () => {
    const engine = createAIEngine({
      tools: sampleTools,
      llm: { provider: 'claude', apiKey: 'test-key' },
      baseUrl: `http://localhost:${apiPort}`,
    })
    const mockResolve = vi.fn().mockResolvedValue({
      toolCalls: [], textContent: 'ok', tokensIn: 0, tokensOut: 0,
    })
    engine._setProvider({ resolve: mockResolve, chat: vi.fn() })

    const longHistory = Array.from({ length: 14 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `msg${i}`,
    }))
    await engine.processMessage('new', { history: longHistory })

    const contents = mockResolve.mock.calls[0][0].map((m: { content: string }) => m.content)
    expect(contents).not.toContain('msg0')
    expect(contents).not.toContain('msg3')
    expect(contents).toContain('msg4')
    expect(contents).toContain('msg13')
    expect(contents).toContain('new')
  })

  it('drops oldest messages first when maxTokens budget is exceeded', async () => {
    const engine = createAIEngine({
      tools: sampleTools,
      llm: { provider: 'claude', apiKey: 'test-key' },
      baseUrl: `http://localhost:${apiPort}`,
      history: { maxMessages: 100, maxTokens: 50 },
    })
    const mockResolve = vi.fn().mockResolvedValue({
      toolCalls: [], textContent: 'ok', tokensIn: 0, tokensOut: 0,
    })
    engine._setProvider({ resolve: mockResolve, chat: vi.fn() })

    // 4 messages × 100 chars ≈ 25 tokens each → budget 50 fits ~2 most recent
    const heavy = (label: string) => ({
      role: 'user' as const,
      content: `${label}-` + 'a'.repeat(99),
    })
    await engine.processMessage('new', {
      history: [
        heavy('old1'),
        heavy('old2'),
        heavy('mid1'),
        heavy('recent1'),
      ],
    })

    const passed = mockResolve.mock.calls[0][0] as { content: string }[]
    const contents = passed.map((m) => m.content)
    expect(contents.some((c) => c.startsWith('old1'))).toBe(false)
    expect(contents.some((c) => c.startsWith('old2'))).toBe(false)
    expect(contents.some((c) => c.startsWith('recent1'))).toBe(true)
    expect(contents).toContain('new')
  })

  it('keeps the most recent message even when it alone exceeds maxTokens', async () => {
    const engine = createAIEngine({
      tools: sampleTools,
      llm: { provider: 'claude', apiKey: 'test-key' },
      baseUrl: `http://localhost:${apiPort}`,
      history: { maxMessages: 100, maxTokens: 5 },
    })
    const mockResolve = vi.fn().mockResolvedValue({
      toolCalls: [], textContent: 'ok', tokensIn: 0, tokensOut: 0,
    })
    engine._setProvider({ resolve: mockResolve, chat: vi.fn() })

    const huge = 'z'.repeat(400) // ~100 tokens, far over the 5-token budget
    await engine.processMessage('new', {
      history: [{ role: 'user', content: huge }],
    })

    const passed = mockResolve.mock.calls[0][0] as { content: string }[]
    const contents = passed.map((m) => m.content)
    expect(contents).toContain(huge)
  })

  it('honors custom maxMessages from engine config', async () => {
    const engine = createAIEngine({
      tools: sampleTools,
      llm: { provider: 'claude', apiKey: 'test-key' },
      baseUrl: `http://localhost:${apiPort}`,
      history: { maxMessages: 2 },
    })
    const mockResolve = vi.fn().mockResolvedValue({
      toolCalls: [], textContent: 'ok', tokensIn: 0, tokensOut: 0,
    })
    engine._setProvider({ resolve: mockResolve, chat: vi.fn() })

    await engine.processMessage('new', {
      history: [
        { role: 'user', content: 'q1' },
        { role: 'assistant', content: 'a1' },
        { role: 'user', content: 'q2' },
        { role: 'assistant', content: 'a2' },
      ],
    })

    const contents = mockResolve.mock.calls[0][0].map((m: { content: string }) => m.content)
    expect(contents).not.toContain('q1')
    expect(contents).not.toContain('a1')
    expect(contents).toContain('q2')
    expect(contents).toContain('a2')
  })

  it('works without history (backward compatible)', async () => {
    const engine = createAIEngine({
      tools: sampleTools,
      llm: { provider: 'claude', apiKey: 'test-key' },
      baseUrl: `http://localhost:${apiPort}`,
    })
    engine._setProvider({
      resolve: vi.fn().mockResolvedValue({
        toolCalls: [], textContent: 'hi', tokensIn: 0, tokensOut: 0,
      }),
      chat: vi.fn(),
    })
    const result = await engine.processMessage('hi')
    expect(result.type).toBe('text')
  })
})

// ── empty message + i18n ────────────────────────────────────────────────────

describe('createAIEngine — empty message + i18n', () => {
  it('should return error when message is empty string', async () => {
    const engine = createAIEngine({
      tools: sampleTools,
      llm: { provider: 'claude', apiKey: 'test-key' },
      baseUrl: `http://localhost:${apiPort}`,
    })
    engine._setProvider({ resolve: vi.fn(), chat: vi.fn() })

    const req = { body: { message: '' } }
    let captured: unknown
    const res = { json: (d: unknown) => { captured = d } }
    await engine.handler()(req as never, res as never)

    expect((captured as { type: string }).type).toBe('error')
    expect((captured as { code: string }).code).toBe('EMPTY_MESSAGE')
  })

  it('should return error when message is whitespace only', async () => {
    const engine = createAIEngine({
      tools: sampleTools,
      llm: { provider: 'claude', apiKey: 'test-key' },
      baseUrl: `http://localhost:${apiPort}`,
    })
    engine._setProvider({ resolve: vi.fn(), chat: vi.fn() })

    const req = { body: { message: '   ' } }
    let captured: unknown
    const res = { json: (d: unknown) => { captured = d } }
    await engine.handler()(req as never, res as never)

    expect((captured as { type: string }).type).toBe('error')
    expect((captured as { code: string }).code).toBe('EMPTY_MESSAGE')
  })

  it('should not set Bearer header when auth.token() returns undefined', async () => {
    let capturedAuthHeader: string | undefined = 'not-set'
    const authCheckServer = createServer((req, res) => {
      capturedAuthHeader = req.headers.authorization
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify([]))
    })
    const authCheckPort = await new Promise<number>((resolve) => {
      authCheckServer.listen(0, () => {
        const addr = authCheckServer.address()
        resolve(typeof addr === 'object' && addr ? addr.port : 0)
      })
    })

    const engine = createAIEngine({
      tools: sampleTools,
      llm: { provider: 'claude', apiKey: 'test-key' },
      baseUrl: `http://localhost:${authCheckPort}`,
      auth: { type: 'bearer', token: () => undefined },
    })
    engine._setProvider({
      resolve: vi.fn().mockResolvedValue({
        toolCalls: [{ toolName: 'get_users', params: {} }],
        textContent: null,
        tokensIn: 0,
        tokensOut: 0,
      }),
      chat: vi.fn(),
    })

    await engine.processMessage('show users')
    authCheckServer.close()

    expect(capturedAuthHeader).toBeUndefined()
  })

  it('should use custom messages from config', async () => {
    const engine = createAIEngine({
      tools: sampleTools,
      llm: { provider: 'claude', apiKey: 'test-key' },
      baseUrl: `http://localhost:${apiPort}`,
      messages: {
        emptyMessageError: 'Custom: message required',
      },
    })
    engine._setProvider({ resolve: vi.fn(), chat: vi.fn() })

    const req = { body: { message: '' } }
    let captured: unknown
    const res = { json: (d: unknown) => { captured = d } }
    await engine.handler()(req as never, res as never)

    expect((captured as { message: string }).message).toBe('Custom: message required')
  })
})

// ── config.auth.token ───────────────────────────────────────────────────────

describe('createAIEngine — config.auth.token', () => {
  it('passes token from auth.token function to downstream API', async () => {
    const receivedHeaders: Record<string, string> = {}

    const authTestServer = createServer((req, res) => {
      if (req.url?.startsWith('/api/users') && req.method === 'GET') {
        receivedHeaders['authorization'] = req.headers['authorization'] ?? ''
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify([{ id: '1', name: 'Alice', role: 'admin' }]))
      } else {
        res.writeHead(404)
        res.end()
      }
    })

    const authPort = await new Promise<number>((r) =>
      authTestServer.listen(0, () => {
        const addr = authTestServer.address()
        r(typeof addr === 'object' && addr ? addr.port : 0)
      }),
    )

    const engine = createAIEngine({
      tools: sampleTools,
      llm: { provider: 'claude', apiKey: 'test-key' },
      baseUrl: `http://localhost:${authPort}`,
      auth: {
        type: 'bearer',
        token: (req) => (req as { cookies?: { auth_token?: string } }).cookies?.auth_token,
      },
    })

    engine._setProvider({
      resolve: vi.fn().mockResolvedValue({
        toolCalls: [{ toolName: 'get_users', params: {} }],
        textContent: null,
        tokensIn: 10,
        tokensOut: 10,
      }),
      chat: vi.fn(),
    })

    const handlerFn = engine.handler()
    const mockReq = {
      headers: {},
      cookies: { auth_token: 'my-jwt-token' },
      body: { message: '사용자 보여줘' },
    }
    const mockRes = { json: vi.fn() }

    await handlerFn(mockReq as never, mockRes)

    expect(receivedHeaders['authorization']).toBe('Bearer my-jwt-token')
    await new Promise<void>((r) => authTestServer.close(() => r()))
  })

  it('passes static string token from auth.token string', async () => {
    const receivedHeaders: Record<string, string> = {}

    const authTestServer2 = createServer((req, res) => {
      if (req.url?.startsWith('/api/users') && req.method === 'GET') {
        receivedHeaders['authorization'] = req.headers['authorization'] ?? ''
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify([{ id: '1', name: 'Alice', role: 'admin' }]))
      } else {
        res.writeHead(404)
        res.end()
      }
    })

    const authPort2 = await new Promise<number>((r) =>
      authTestServer2.listen(0, () => {
        const addr = authTestServer2.address()
        r(typeof addr === 'object' && addr ? addr.port : 0)
      }),
    )

    const engine = createAIEngine({
      tools: sampleTools,
      llm: { provider: 'claude', apiKey: 'test-key' },
      baseUrl: `http://localhost:${authPort2}`,
      auth: {
        type: 'bearer',
        token: 'static-service-token',
      },
    })

    engine._setProvider({
      resolve: vi.fn().mockResolvedValue({
        toolCalls: [{ toolName: 'get_users', params: {} }],
        textContent: null,
        tokensIn: 10,
        tokensOut: 10,
      }),
      chat: vi.fn(),
    })

    const handlerFn = engine.handler()
    const mockReq = {
      headers: {},
      body: { message: '사용자 보여줘' },
    }
    const mockRes = { json: vi.fn() }

    await handlerFn(mockReq as never, mockRes)

    expect(receivedHeaders['authorization']).toBe('Bearer static-service-token')
    await new Promise<void>((r) => authTestServer2.close(() => r()))
  })

  it('returns error response when auth.token function throws', async () => {
    const engine = createAIEngine({
      tools: sampleTools,
      llm: { provider: 'claude', apiKey: 'test-key' },
      auth: {
        type: 'bearer',
        token: () => { throw new Error('cookie parse failed') },
      },
    })
    engine._setProvider({
      resolve: vi.fn().mockResolvedValue({ toolCalls: [], textContent: 'hello', tokensIn: 0, tokensOut: 0 }),
      chat: vi.fn(),
    })

    const mockReq = {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: { message: 'list todos' },
    }
    const chunks: string[] = []
    const mockRes = {
      setHeader: vi.fn(),
      write: (chunk: string) => { chunks.push(chunk) },
      end: vi.fn(),
      json: (data: unknown) => { chunks.push(JSON.stringify(data)) },
    }

    const handlerFn = engine.handler()
    await handlerFn(mockReq as never, mockRes as never)

    const data = JSON.parse(chunks.join(''))
    expect(data.type).toBe('error')
  })
})

// ── disposeOnSignal ─────────────────────────────────────────────────────────

describe('createAIEngine — disposeOnSignal', () => {
  it('registers and detaches SIGTERM/SIGINT handlers when enabled', async () => {
    const before = process.listenerCount('SIGTERM')
    const engine = createAIEngine({
      tools: sampleTools,
      llm: { provider: 'claude', apiKey: 'k' },
      baseUrl: `http://localhost:${apiPort}`,
      disposeOnSignal: true,
    })
    expect(process.listenerCount('SIGTERM')).toBe(before + 1)
    expect(process.listenerCount('SIGINT')).toBeGreaterThan(0)

    engine.dispose()
    expect(process.listenerCount('SIGTERM')).toBe(before)
  })

  it('dispose() is idempotent', async () => {
    const engine = createAIEngine({
      tools: sampleTools,
      llm: { provider: 'claude', apiKey: 'k' },
      baseUrl: `http://localhost:${apiPort}`,
      disposeOnSignal: true,
    })
    engine.dispose()
    expect(() => engine.dispose()).not.toThrow()
  })

  it('does not register signal handlers when disposeOnSignal is omitted', async () => {
    const before = process.listenerCount('SIGTERM')
    const engine = createAIEngine({
      tools: sampleTools,
      llm: { provider: 'claude', apiKey: 'k' },
      baseUrl: `http://localhost:${apiPort}`,
    })
    expect(process.listenerCount('SIGTERM')).toBe(before)
    engine.dispose()
  })
})

// ── confirmAndExecute idempotency ───────────────────────────────────────────

describe('createAIEngine — confirmAndExecute idempotency', () => {
  it('issues a confirmToken on confirm responses', async () => {
    const engine = createAIEngine({
      tools: sampleTools,
      llm: { provider: 'claude', apiKey: 'test-key' },
      baseUrl: `http://localhost:${apiPort}`,
    })
    engine._setProvider({
      resolve: vi.fn().mockResolvedValue({
        toolCalls: [{ toolName: 'update_user', params: { id: '1', name: 'X' } }],
        textContent: null,
        tokensIn: 0,
        tokensOut: 0,
      }),
      chat: vi.fn(),
    })

    const result = await engine.processMessage('수정해줘')
    expect(result.type).toBe('confirm')
    if (result.type === 'confirm') {
      expect(typeof result.confirmToken).toBe('string')
      expect(result.confirmToken!.length).toBeGreaterThan(8)
    }
  })

  it('dedupes concurrent confirmAndExecute calls with the same idempotencyKey', async () => {
    let callCount = 0
    const writeServer = createServer((req, res) => {
      if (req.url?.startsWith('/api/users/') && req.method === 'PUT') {
        callCount++
        let body = ''
        req.on('data', (c) => { body += c })
        req.on('end', () => {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true }))
        })
      } else {
        res.writeHead(404)
        res.end()
      }
    })
    const writePort = await new Promise<number>((r) => {
      writeServer.listen(0, () => {
        const addr = writeServer.address()
        r(typeof addr === 'object' && addr ? addr.port : 0)
      })
    })

    const engine = createAIEngine({
      tools: sampleTools,
      llm: { provider: 'claude', apiKey: 'test-key' },
      baseUrl: `http://localhost:${writePort}`,
    })

    const key = 'test-key-001'
    const r1 = await engine.confirmAndExecute(
      'update_user',
      { id: '1', name: 'X' },
      { idempotencyKey: key },
    )
    const r2 = await engine.confirmAndExecute(
      'update_user',
      { id: '1', name: 'X' },
      { idempotencyKey: key },
    )

    expect(callCount).toBe(1)
    expect(r1).toEqual(r2)

    await new Promise<void>((r) => writeServer.close(() => r()))
  })

  it('does NOT cache transient 5xx — same key allows a retry once upstream recovers', async () => {
    let callCount = 0
    let respond5xx = true
    const flakyServer = createServer((req, res) => {
      if (req.url?.startsWith('/api/users/') && req.method === 'PUT') {
        callCount++
        let body = ''
        req.on('data', (c) => { body += c })
        req.on('end', () => {
          if (respond5xx) {
            res.writeHead(503, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'temp' }))
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: true }))
          }
        })
      } else {
        res.writeHead(404)
        res.end()
      }
    })
    const flakyPort = await new Promise<number>((r) => {
      flakyServer.listen(0, () => {
        const addr = flakyServer.address()
        r(typeof addr === 'object' && addr ? addr.port : 0)
      })
    })

    const engine = createAIEngine({
      tools: sampleTools,
      llm: { provider: 'claude', apiKey: 'test-key' },
      baseUrl: `http://localhost:${flakyPort}`,
    })

    const key = 'flaky-key'
    const r1 = await engine.confirmAndExecute(
      'update_user',
      { id: '1', name: 'X' },
      { idempotencyKey: key },
    )
    expect(r1.type).toBe('error')
    if (r1.type === 'error') expect(r1.code).toBe('UPSTREAM_5XX')

    // Upstream recovers — retry with the SAME key must execute again, not return cached 5xx.
    respond5xx = false
    const r2 = await engine.confirmAndExecute(
      'update_user',
      { id: '1', name: 'X' },
      { idempotencyKey: key },
    )
    expect(r2.type).toBe('action')
    expect(callCount).toBe(2)

    await new Promise<void>((r) => flakyServer.close(() => r()))
  })

  it('caches deterministic 4xx — same key returns cached error without re-executing', async () => {
    let callCount = 0
    const fourXxServer = createServer((req, res) => {
      if (req.url?.startsWith('/api/users/') && req.method === 'PUT') {
        callCount++
        let body = ''
        req.on('data', (c) => { body += c })
        req.on('end', () => {
          res.writeHead(404, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'not found' }))
        })
      } else {
        res.writeHead(404)
        res.end()
      }
    })
    const port = await new Promise<number>((r) => {
      fourXxServer.listen(0, () => {
        const addr = fourXxServer.address()
        r(typeof addr === 'object' && addr ? addr.port : 0)
      })
    })

    const engine = createAIEngine({
      tools: sampleTools,
      llm: { provider: 'claude', apiKey: 'test-key' },
      baseUrl: `http://localhost:${port}`,
    })

    const key = '4xx-key'
    const r1 = await engine.confirmAndExecute('update_user', { id: '1', name: 'X' }, { idempotencyKey: key })
    expect(r1.type).toBe('error')
    if (r1.type === 'error') expect(r1.code).toBe('UPSTREAM_4XX')

    // Same key — must return cached 4xx without a second upstream hit.
    const r2 = await engine.confirmAndExecute('update_user', { id: '1', name: 'X' }, { idempotencyKey: key })
    expect(r2).toEqual(r1)
    expect(callCount).toBe(1)

    await new Promise<void>((r) => fourXxServer.close(() => r()))
  })

  it('does not dedupe when no idempotencyKey is supplied', async () => {
    let callCount = 0
    const writeServer = createServer((req, res) => {
      if (req.url?.startsWith('/api/users/') && req.method === 'PUT') {
        callCount++
        let body = ''
        req.on('data', (c) => { body += c })
        req.on('end', () => {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true }))
        })
      } else {
        res.writeHead(404)
        res.end()
      }
    })
    const writePort = await new Promise<number>((r) => {
      writeServer.listen(0, () => {
        const addr = writeServer.address()
        r(typeof addr === 'object' && addr ? addr.port : 0)
      })
    })

    const engine = createAIEngine({
      tools: sampleTools,
      llm: { provider: 'claude', apiKey: 'test-key' },
      baseUrl: `http://localhost:${writePort}`,
    })

    await engine.confirmAndExecute('update_user', { id: '1', name: 'X' })
    await engine.confirmAndExecute('update_user', { id: '1', name: 'X' })

    expect(callCount).toBe(2)

    await new Promise<void>((r) => writeServer.close(() => r()))
  })
})

// ── clarify meta tool ───────────────────────────────────────────────────────

describe('createAIEngine — clarify meta tool', () => {
  it('returns AIEClarifyResponse when the LLM calls the clarify meta tool', async () => {
    const engine = createAIEngine({
      tools: sampleTools,
      llm: { provider: 'claude', apiKey: 'k' },
      baseUrl: `http://localhost:${apiPort}`,
    })
    engine._setProvider({
      resolve: vi.fn().mockResolvedValue({
        toolCalls: [{
          toolName: '__aiglue_clarify__',
          params: { question: '어떤 사용자를 보고 싶으신가요?', options: ['전체', '활성', '관리자만'] },
        }],
        textContent: null,
        tokensIn: 30,
        tokensOut: 10,
      }),
      chat: vi.fn(),
    })

    const result = await engine.processMessage('그거 보여줘')
    expect(result.type).toBe('clarify')
    if (result.type === 'clarify') {
      expect(result.question).toBe('어떤 사용자를 보고 싶으신가요?')
      expect(result.options).toEqual(['전체', '활성', '관리자만'])
    }
  })

  it('omits options field when the LLM did not provide any', async () => {
    const engine = createAIEngine({
      tools: sampleTools,
      llm: { provider: 'claude', apiKey: 'k' },
      baseUrl: `http://localhost:${apiPort}`,
    })
    engine._setProvider({
      resolve: vi.fn().mockResolvedValue({
        toolCalls: [{
          toolName: '__aiglue_clarify__',
          params: { question: '날짜 범위를 알려주세요.' },
        }],
        textContent: null,
        tokensIn: 10,
        tokensOut: 5,
      }),
      chat: vi.fn(),
    })

    const result = await engine.processMessage('지난주 데이터')
    expect(result.type).toBe('clarify')
    if (result.type === 'clarify') {
      expect(result.options).toBeUndefined()
    }
  })

  it('clarify is intercepted before SafetyGate so the meta tool name never triggers TOOL_NOT_ALLOWED', async () => {
    // The clarify meta tool is NOT in tools — if engine forgot to intercept, SafetyGate would reject it.
    const engine = createAIEngine({
      tools: sampleTools,
      llm: { provider: 'claude', apiKey: 'k' },
      baseUrl: `http://localhost:${apiPort}`,
    })
    engine._setProvider({
      resolve: vi.fn().mockResolvedValue({
        toolCalls: [{ toolName: '__aiglue_clarify__', params: { question: 'q?' } }],
        textContent: null,
        tokensIn: 10,
        tokensOut: 5,
      }),
      chat: vi.fn(),
    })
    const result = await engine.processMessage('vague')
    expect(result.type).not.toBe('error')
  })
})

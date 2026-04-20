import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { createAIEngine } from '../src/engine.js'
import { resolve } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { createServer, type Server } from 'http'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const fixturePath = resolve(__dirname, 'fixtures/sample-tools.yaml')

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

describe('createAIEngine', () => {
  it('should create an engine instance', () => {
    const engine = createAIEngine({
      tools: fixturePath,
      llm: { provider: 'claude', apiKey: 'test-key' },
      baseUrl: `http://localhost:${apiPort}`,
    })
    expect(engine).toBeDefined()
    expect(typeof engine.handler).toBe('function')
    expect(typeof engine.processMessage).toBe('function')
  })

  it('should process a message with mocked LLM and return table', async () => {
    const engine = createAIEngine({
      tools: fixturePath,
      llm: { provider: 'claude', apiKey: 'test-key' },
      baseUrl: `http://localhost:${apiPort}`,
    })

    engine._setProvider({
      resolve: vi.fn().mockResolvedValue({
        toolCall: { toolName: 'get_users', params: {} },
        textContent: null,
        tokensIn: 500,
        tokensOut: 50,
      }),
    })

    const result = await engine.processMessage('사용자 보여줘')
    expect(result.type).toBe('table')
  })

  it('should return text when LLM returns no tool call', async () => {
    const engine = createAIEngine({
      tools: fixturePath,
      llm: { provider: 'claude', apiKey: 'test-key' },
      baseUrl: `http://localhost:${apiPort}`,
    })

    engine._setProvider({
      resolve: vi.fn().mockResolvedValue({
        toolCall: null,
        textContent: '무엇을 도와드릴까요?',
        tokensIn: 100,
        tokensOut: 20,
      }),
    })

    const result = await engine.processMessage('안녕')
    expect(result.type).toBe('text')
    if (result.type === 'text') {
      expect(result.content).toBe('무엇을 도와드릴까요?')
    }
  })

  it('should return error when tool is not in whitelist', async () => {
    const engine = createAIEngine({
      tools: fixturePath,
      llm: { provider: 'claude', apiKey: 'test-key' },
      baseUrl: `http://localhost:${apiPort}`,
    })

    engine._setProvider({
      resolve: vi.fn().mockResolvedValue({
        toolCall: { toolName: 'hack_system', params: {} },
        textContent: null,
        tokensIn: 100,
        tokensOut: 20,
      }),
    })

    const result = await engine.processMessage('해킹해줘')
    expect(result.type).toBe('error')
  })

  it('should return confirm for write tools', async () => {
    const engine = createAIEngine({
      tools: fixturePath,
      llm: { provider: 'claude', apiKey: 'test-key' },
      baseUrl: `http://localhost:${apiPort}`,
    })

    engine._setProvider({
      resolve: vi.fn().mockResolvedValue({
        toolCall: { toolName: 'update_user', params: { id: '1', name: 'Updated' } },
        textContent: null,
        tokensIn: 100,
        tokensOut: 20,
      }),
    })

    const result = await engine.processMessage('사용자 수정해줘')
    expect(result.type).toBe('confirm')
  })

  it('should return error on LLM failure', async () => {
    const engine = createAIEngine({
      tools: fixturePath,
      llm: { provider: 'claude', apiKey: 'test-key' },
      baseUrl: `http://localhost:${apiPort}`,
    })

    engine._setProvider({
      resolve: vi.fn().mockRejectedValue(new Error('LLM timeout')),
    })

    const result = await engine.processMessage('뭐든')
    expect(result.type).toBe('error')
  })
})

describe('createAIEngine — history passthrough', () => {
  it('relays client-provided history to the resolver', async () => {
    const engine = createAIEngine({
      tools: fixturePath,
      llm: { provider: 'claude', apiKey: 'test-key' },
      baseUrl: `http://localhost:${apiPort}`,
    })

    const mockResolve = vi.fn().mockResolvedValue({
      toolCall: null,
      textContent: 'ok',
      tokensIn: 0,
      tokensOut: 0,
    })
    engine._setProvider({ resolve: mockResolve })

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
      tools: fixturePath,
      llm: { provider: 'claude', apiKey: 'test-key' },
      baseUrl: `http://localhost:${apiPort}`,
    })
    const mockResolve = vi.fn().mockResolvedValue({
      toolCall: null, textContent: 'ok', tokensIn: 0, tokensOut: 0,
    })
    engine._setProvider({ resolve: mockResolve })

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

  it('honors custom maxMessages from engine config', async () => {
    const engine = createAIEngine({
      tools: fixturePath,
      llm: { provider: 'claude', apiKey: 'test-key' },
      baseUrl: `http://localhost:${apiPort}`,
      history: { maxMessages: 2 },
    })
    const mockResolve = vi.fn().mockResolvedValue({
      toolCall: null, textContent: 'ok', tokensIn: 0, tokensOut: 0,
    })
    engine._setProvider({ resolve: mockResolve })

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
      tools: fixturePath,
      llm: { provider: 'claude', apiKey: 'test-key' },
      baseUrl: `http://localhost:${apiPort}`,
    })
    engine._setProvider({
      resolve: vi.fn().mockResolvedValue({
        toolCall: null, textContent: 'hi', tokensIn: 0, tokensOut: 0,
      }),
    })
    const result = await engine.processMessage('hi')
    expect(result.type).toBe('text')
  })
})

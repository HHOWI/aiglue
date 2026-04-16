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

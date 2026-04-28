import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { resolve } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { createServer, type Server } from 'http'
import { createAIEngine } from '../src/engine.js'
import type { LLMProvider } from '../src/providers/types.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const fixturePath = resolve(__dirname, 'fixtures/sample-tools.yaml')

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

describe("createAIEngine — provider: 'custom'", () => {
  it('routes resolve / chat through the user-supplied LLMProvider instance', async () => {
    const resolveMock = vi.fn().mockResolvedValue({
      toolCall: { toolName: 'get_users', params: {} },
      textContent: null,
      tokensIn: 7,
      tokensOut: 3,
    })
    const chatMock = vi.fn().mockResolvedValue({ text: 'sum', tokensIn: 1, tokensOut: 1 })
    const customProvider: LLMProvider = {
      resolve: resolveMock,
      chat: chatMock,
    }

    const engine = createAIEngine({
      tools: fixturePath,
      llm: { provider: 'custom', instance: customProvider },
      baseUrl: `http://localhost:${apiPort}`,
    })

    const result = await engine.processMessage('show users')
    expect(result.type).toBe('table')
    // The custom provider received the resolve call — no real Anthropic / OpenAI SDK was invoked.
    expect(resolveMock).toHaveBeenCalledTimes(1)
  })

  it("throws when provider: 'custom' is set without an instance", () => {
    expect(() =>
      createAIEngine({
        tools: fixturePath,
        llm: { provider: 'custom' } as unknown as { provider: 'custom'; instance: LLMProvider },
        baseUrl: `http://localhost:${apiPort}`,
      }),
    ).toThrow(/requires LLMConfig\.instance/)
  })
})

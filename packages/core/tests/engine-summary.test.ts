import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { createServer, type Server } from 'http'
import { createAIEngine } from '../src/engine.js'
import { defineTool } from '../src/define-tool.js'

const summaryTools = [
  defineTool({
    name: 'get_user_summary',
    description: 'Get user info, summarized as natural language',
    endpoint: 'GET /api/user',
    responseType: 'summary',
    columns: [{ key: 'id', label: 'ID' }],
  }),
  defineTool({
    name: 'list_sales_with_summary',
    description: 'List sales as a table with an LLM summary sentence',
    endpoint: 'GET /api/sales',
    responseType: 'table',
    includeSummary: true,
    columns: [
      { key: 'id', label: 'ID' },
      { key: 'total', label: 'Total' },
    ],
  }),
  defineTool({
    name: 'list_sales_plain',
    description: 'List sales without summary',
    endpoint: 'GET /api/sales',
    responseType: 'table',
    columns: [
      { key: 'id', label: 'ID' },
      { key: 'total', label: 'Total' },
    ],
  }),
]

let mockApi: Server
let apiPort: number

beforeAll(async () => {
  mockApi = createServer((req, res) => {
    if (req.url === '/api/user' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ id: 1, name: 'Alice', role: 'admin' }))
    } else if (req.url === '/api/sales' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify([{ id: 1, total: 100 }, { id: 2, total: 200 }]))
    } else {
      res.writeHead(404)
      res.end()
    }
  })
  await new Promise<void>((r) => {
    mockApi.listen(0, () => {
      const addr = mockApi.address()
      apiPort = typeof addr === 'object' && addr ? addr.port : 0
      r()
    })
  })
})

afterAll(() => mockApi.close())

describe('engine summary path', () => {
  it('returns AIESummaryResponse when tool has responseType: summary', async () => {
    const engine = createAIEngine({
      tools: summaryTools,
      llm: { provider: 'claude', apiKey: 'x' },
      baseUrl: `http://localhost:${apiPort}`,
    })

    engine._setProvider({
      resolve: vi.fn().mockResolvedValue({
        toolCalls: [{ toolName: 'get_user_summary', params: {} }],
        textContent: null,
        tokensIn: 10,
        tokensOut: 5,
      }),
      chat: vi.fn().mockResolvedValue({
        text: 'Alice는 admin이고 현재 활성입니다.',
        tokensIn: 20,
        tokensOut: 15,
      }),
    })

    const result = await engine.processMessage('Alice 정보 알려줘')
    expect(result.type).toBe('summary')
    if (result.type === 'summary') {
      expect(result.text).toBe('Alice는 admin이고 현재 활성입니다.')
      expect(result.source).toEqual({ id: 1, name: 'Alice', role: 'admin' })
    }
  })

  it('adds summary field to table when includeSummary is true', async () => {
    const engine = createAIEngine({
      tools: summaryTools,
      llm: { provider: 'claude', apiKey: 'x' },
      baseUrl: `http://localhost:${apiPort}`,
    })

    engine._setProvider({
      resolve: vi.fn().mockResolvedValue({
        toolCalls: [{ toolName: 'list_sales_with_summary', params: {} }],
        textContent: null,
        tokensIn: 10,
        tokensOut: 5,
      }),
      chat: vi.fn().mockResolvedValue({
        text: '총 2건, 합계 300',
        tokensIn: 12,
        tokensOut: 6,
      }),
    })

    const result = await engine.processMessage('매출 리스트')
    expect(result.type).toBe('table')
    if (result.type === 'table') {
      expect(result.rows).toHaveLength(2)
      expect(result.summary).toBe('총 2건, 합계 300')
    }
  })

  it('does not call chat() for tools without summary opt-in', async () => {
    const engine = createAIEngine({
      tools: summaryTools,
      llm: { provider: 'claude', apiKey: 'x' },
      baseUrl: `http://localhost:${apiPort}`,
    })

    const chatMock = vi.fn().mockResolvedValue({ text: 'should not be used', tokensIn: 0, tokensOut: 0 })
    engine._setProvider({
      resolve: vi.fn().mockResolvedValue({
        toolCalls: [{ toolName: 'list_sales_plain', params: {} }],
        textContent: null,
        tokensIn: 10,
        tokensOut: 5,
      }),
      chat: chatMock,
    })

    const result = await engine.processMessage('매출 리스트')
    expect(result.type).toBe('table')
    expect(chatMock).not.toHaveBeenCalled()
  })

  it('degrades summary to text fallback when chat() fails', async () => {
    const engine = createAIEngine({
      tools: summaryTools,
      llm: { provider: 'claude', apiKey: 'x' },
      baseUrl: `http://localhost:${apiPort}`,
    })

    engine._setProvider({
      resolve: vi.fn().mockResolvedValue({
        toolCalls: [{ toolName: 'get_user_summary', params: {} }],
        textContent: null,
        tokensIn: 10,
        tokensOut: 5,
      }),
      chat: vi.fn().mockRejectedValue(new Error('rate limit')),
    })

    const result = await engine.processMessage('Alice?')
    expect(result.type).toBe('text')
    if (result.type === 'text') {
      expect(result.content).toContain('Alice')
    }
  })
})

import { describe, it, expect, vi } from 'vitest'
import http from 'node:http'
import { createAIEngine } from '../src/engine.js'
import { defineTool } from '../src/define-tool.js'

describe('engine — parallel tool use', () => {
  it('runs two read tools in parallel and returns AIEMultiResponse', async () => {
    const server = http.createServer((req, res) => {
      res.setHeader('content-type', 'application/json')
      if (req.url?.startsWith('/sales')) res.end(JSON.stringify({ total: 100 }))
      else if (req.url?.startsWith('/unpaid')) res.end(JSON.stringify({ count: 3 }))
      else { res.statusCode = 404; res.end() }
    }).listen(0)
    const port = (server.address() as { port: number }).port

    const sales = defineTool({ name: 'sales', description: 'today sales', endpoint: 'GET /sales', responseType: 'raw', riskLevel: 'read' })
    const unpaid = defineTool({ name: 'unpaid', description: 'unpaid count', endpoint: 'GET /unpaid', responseType: 'raw', riskLevel: 'read' })

    const engine = createAIEngine({
      tools: [sales, unpaid],
      baseUrl: `http://127.0.0.1:${port}`,
      llm: { provider: 'claude', apiKey: 'sk-test' },
    })
    engine._setProvider({
      resolve: vi.fn().mockResolvedValue({
        toolCalls: [
          { toolName: 'sales', params: {} },
          { toolName: 'unpaid', params: {} },
        ],
        textContent: null, tokensIn: 0, tokensOut: 0,
      }),
      chat: vi.fn(),
    })

    const result = await engine.processMessage('show both')
    expect(result.type).toBe('multi')
    if (result.type === 'multi') {
      expect(result.results).toHaveLength(2)
      expect((result.results[0] as { type: 'raw'; data: unknown }).data).toEqual({ total: 100 })
      expect((result.results[1] as { type: 'raw'; data: unknown }).data).toEqual({ count: 3 })
    }
    server.close()
  })

  it('rejects parallel calls when any tool is write/critical', async () => {
    const read = defineTool({ name: 'read_x', description: 'x', endpoint: 'GET /x', responseType: 'raw', riskLevel: 'read' })
    const write = defineTool({ name: 'do_y', description: 'y', endpoint: 'POST /y', riskLevel: 'write', confirmMessage: 'confirm?' })
    const engine = createAIEngine({ tools: [read, write], baseUrl: 'http://127.0.0.1:1', llm: { provider: 'claude', apiKey: 'sk-test' } })
    engine._setProvider({
      resolve: vi.fn().mockResolvedValue({
        toolCalls: [
          { toolName: 'read_x', params: {} },
          { toolName: 'do_y', params: {} },
        ],
        textContent: null, tokensIn: 0, tokensOut: 0,
      }),
      chat: vi.fn(),
    })
    const result = await engine.processMessage('do both')
    expect(result.type).toBe('error')
    if (result.type === 'error') expect(result.code).toBe('PARALLEL_WRITE_NOT_ALLOWED')
  })

  it('returns TOOL_NOT_FOUND when LLM emits an unknown tool name in parallel', async () => {
    const sales = defineTool({ name: 'sales', description: 'today sales', endpoint: 'GET /sales', responseType: 'raw', riskLevel: 'read' })
    const engine = createAIEngine({
      tools: [sales],
      baseUrl: 'http://127.0.0.1:1',
      llm: { provider: 'claude', apiKey: 'sk-test' },
    })
    engine._setProvider({
      resolve: vi.fn().mockResolvedValue({
        toolCalls: [
          { toolName: 'sales', params: {} },
          { toolName: 'mystery_tool', params: {} },
        ],
        textContent: null, tokensIn: 0, tokensOut: 0,
      }),
      chat: vi.fn(),
    })
    const result = await engine.processMessage('show both')
    expect(result.type).toBe('error')
    if (result.type === 'error') expect(result.code).toBe('TOOL_NOT_FOUND')
  })
})

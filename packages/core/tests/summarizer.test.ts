import { describe, it, expect, vi } from 'vitest'
import { Summarizer } from '../src/summarizer.js'
import type { LLMProvider } from '../src/providers/types.js'
import type { ToolDefinition, AIEResponse, AIETableResponse } from '../src/types.js'

function makeProvider(chatResult: { text: string; tokensIn?: number; tokensOut?: number } | Error): LLMProvider {
  return {
    resolve: vi.fn(),
    chat: vi.fn().mockImplementation(() => {
      if (chatResult instanceof Error) return Promise.reject(chatResult)
      return Promise.resolve({
        text: chatResult.text,
        tokensIn: chatResult.tokensIn ?? 1,
        tokensOut: chatResult.tokensOut ?? 1,
      })
    }),
  }
}

const summaryTool: ToolDefinition = {
  name: 'get_user',
  description: 'Get user info',
  endpoint: 'GET /api/users/:id',
  response_type: 'summary',
}

const tableWithSummaryTool: ToolDefinition = {
  name: 'list_sales',
  description: 'List sales',
  endpoint: 'GET /api/sales',
  response_type: 'table',
  include_summary: true,
  columns: [{ key: 'id', label: 'ID' }],
}

const plainTableTool: ToolDefinition = {
  name: 'plain',
  description: 'Plain',
  endpoint: 'GET /api/plain',
  response_type: 'table',
  columns: [{ key: 'id', label: 'ID' }],
}

describe('Summarizer.maybeSummarize', () => {
  it('replaces base with AIESummaryResponse when response_type is summary', async () => {
    const provider = makeProvider({ text: 'Alice는 admin입니다.' })
    const summarizer = new Summarizer(provider)
    const base: AIEResponse = { type: 'text', content: '{"id":1}' }
    const apiResponse = { id: 1, name: 'Alice', role: 'admin' }

    const result = await summarizer.maybeSummarize(
      summaryTool,
      'Alice 정보 알려줘',
      apiResponse,
      base,
    )

    expect(result.type).toBe('summary')
    if (result.type === 'summary') {
      expect(result.text).toBe('Alice는 admin입니다.')
      expect(result.source).toBe(apiResponse)
    }
    expect(provider.chat).toHaveBeenCalledTimes(1)
  })

  it('passes user question, tool name, and max_tokens=300 to chat()', async () => {
    const provider = makeProvider({ text: 'ok' })
    const summarizer = new Summarizer(provider)
    const base: AIEResponse = { type: 'text', content: '{}' }

    await summarizer.maybeSummarize(summaryTool, '원본 질문', { foo: 'bar' }, base)

    const callArgs = (provider.chat as ReturnType<typeof vi.fn>).mock.calls[0]
    const messages = callArgs[0] as Array<{ role: string; content: string }>
    const opts = callArgs[1] as { system?: string; maxTokens?: number }

    expect(opts.maxTokens).toBe(300)
    expect(opts.system).toBeDefined()
    expect(messages.some(m => m.content.includes('원본 질문'))).toBe(true)
    expect(messages.some(m => m.content.includes('get_user'))).toBe(true)
  })

  it('fills AIETableResponse.summary when include_summary is true', async () => {
    const provider = makeProvider({ text: '총 5건, 합계 ₩1,000' })
    const summarizer = new Summarizer(provider)
    const base: AIETableResponse = {
      type: 'table',
      columns: [{ key: 'id', label: 'ID' }],
      rows: [{ id: 1 }],
    }

    const result = await summarizer.maybeSummarize(
      tableWithSummaryTool,
      '매출 보여줘',
      { items: [{ id: 1 }] },
      base,
    )

    expect(result.type).toBe('table')
    if (result.type === 'table') {
      expect(result.summary).toBe('총 5건, 합계 ₩1,000')
      expect(result.rows).toEqual([{ id: 1 }])
    }
  })

  it('returns base unchanged when tool has no summary opt-in', async () => {
    const provider = makeProvider({ text: 'unused' })
    const summarizer = new Summarizer(provider)
    const base: AIEResponse = {
      type: 'table',
      columns: [{ key: 'id', label: 'ID' }],
      rows: [{ id: 1 }],
    }

    const result = await summarizer.maybeSummarize(plainTableTool, 'q', { items: [] }, base)

    expect(result).toBe(base)
    expect(provider.chat).not.toHaveBeenCalled()
  })

  it('degrades summary-only to text fallback on chat() error', async () => {
    const provider = makeProvider(new Error('rate limited'))
    const summarizer = new Summarizer(provider)
    const base: AIEResponse = { type: 'text', content: 'base' }
    const apiResponse = { id: 1, name: 'Alice' }

    const result = await summarizer.maybeSummarize(summaryTool, 'q', apiResponse, base)

    expect(result.type).toBe('text')
    if (result.type === 'text') {
      expect(result.content).toContain('Alice')
      expect(result.content.length).toBeLessThanOrEqual(2000)
    }
  })

  it('skips summary field on include_summary error, returns base table unchanged', async () => {
    const provider = makeProvider(new Error('timeout'))
    const summarizer = new Summarizer(provider)
    const base: AIETableResponse = {
      type: 'table',
      columns: [{ key: 'id', label: 'ID' }],
      rows: [{ id: 1 }],
    }

    const result = await summarizer.maybeSummarize(
      tableWithSummaryTool,
      'q',
      { items: [{ id: 1 }] },
      base,
    )

    expect(result.type).toBe('table')
    if (result.type === 'table') {
      expect(result.summary).toBeUndefined()
      expect(result.rows).toEqual([{ id: 1 }])
    }
  })

  it('truncates large source in text fallback to 2000 chars', async () => {
    const provider = makeProvider(new Error('fail'))
    const summarizer = new Summarizer(provider)
    const huge = { items: Array.from({ length: 500 }, (_, i) => ({ id: i, name: 'row' + i })) }
    const base: AIEResponse = { type: 'text', content: 'base' }

    const result = await summarizer.maybeSummarize(summaryTool, 'q', huge, base)

    expect(result.type).toBe('text')
    if (result.type === 'text') {
      expect(result.content.length).toBeLessThanOrEqual(2000)
    }
  })
})

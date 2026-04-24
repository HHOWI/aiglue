import { describe, it, expect } from 'vitest'
import { createServer, type Server } from 'http'
import { OpenAIProvider } from '../../src/providers/openai.js'
import type { LLMToolDefinition } from '../../src/types.js'

const basicTool: LLMToolDefinition = {
  name: 'get_posts',
  description: 'Get posts for a user',
  parameters: {
    type: 'object',
    properties: { userId: { type: 'number' } },
    required: ['userId'],
  },
}

interface MockServer {
  url: string
  close: () => Promise<void>
  lastBody: () => string
  lastHeaders: () => Record<string, string | string[] | undefined>
}

function startMockServer(response: unknown): Promise<MockServer> {
  let lastBody = ''
  let lastHeaders: Record<string, string | string[] | undefined> = {}
  return new Promise((resolvePromise) => {
    const server: Server = createServer((req, res) => {
      let body = ''
      req.on('data', (c) => {
        body += c
      })
      req.on('end', () => {
        lastBody = body
        lastHeaders = req.headers
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify(response))
      })
    })
    server.listen(0, () => {
      const addr = server.address()
      if (!addr || typeof addr === 'string') throw new Error('bad addr')
      resolvePromise({
        url: `http://localhost:${addr.port}/v1`,
        close: () =>
          new Promise<void>((r) => {
            server.close(() => r())
          }),
        lastBody: () => lastBody,
        lastHeaders: () => lastHeaders,
      })
    })
  })
}

describe('OpenAIProvider', () => {
  it('throws when model is empty', () => {
    expect(
      () => new OpenAIProvider({ apiKey: 'x', model: '', baseUrl: 'http://x' }),
    ).toThrow(/model/)
  })

  it('parses tool_calls into toolCall with JSON-decoded params', async () => {
    const server = await startMockServer({
      id: 'chatcmpl-1',
      object: 'chat.completion',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name: 'get_posts', arguments: '{"userId":1}' },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: { prompt_tokens: 42, completion_tokens: 8, total_tokens: 50 },
    })

    const provider = new OpenAIProvider({
      apiKey: 'test',
      model: 'gpt-4o-mini',
      baseUrl: server.url,
    })

    const result = await provider.resolve(
      [{ role: 'user', content: 'show user 1 posts' }],
      [basicTool],
    )

    expect(result.toolCall).toEqual({
      toolName: 'get_posts',
      params: { userId: 1 },
    })
    expect(result.textContent).toBeNull()
    expect(result.tokensIn).toBe(42)
    expect(result.tokensOut).toBe(8)

    await server.close()
  })

  it('returns textContent when the model does not call a tool', async () => {
    const server = await startMockServer({
      choices: [
        {
          message: { role: 'assistant', content: 'Hello there' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
    })
    const provider = new OpenAIProvider({
      apiKey: 'test',
      model: 'gpt-4o-mini',
      baseUrl: server.url,
    })
    const result = await provider.resolve(
      [{ role: 'user', content: 'hi' }],
      [basicTool],
    )
    expect(result.toolCall).toBeNull()
    expect(result.textContent).toBe('Hello there')
    await server.close()
  })

  it('sends tools in OpenAI function schema format', async () => {
    const server = await startMockServer({
      choices: [{ message: { role: 'assistant', content: 'ok' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    })
    const provider = new OpenAIProvider({
      apiKey: 'test',
      model: 'gpt-4o-mini',
      baseUrl: server.url,
    })
    await provider.resolve([{ role: 'user', content: 'test' }], [basicTool])
    const body = JSON.parse(server.lastBody())
    expect(body.model).toBe('gpt-4o-mini')
    expect(body.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'get_posts',
          description: 'Get posts for a user',
          parameters: basicTool.parameters,
        },
      },
    ])
    await server.close()
  })

  it('preserves system/user/assistant roles in the messages payload', async () => {
    const server = await startMockServer({
      choices: [{ message: { role: 'assistant', content: 'ok' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    })
    const provider = new OpenAIProvider({
      apiKey: 'test',
      model: 'gpt-4o-mini',
      baseUrl: server.url,
    })
    await provider.resolve(
      [
        { role: 'system', content: 'You are helpful' },
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
        { role: 'user', content: 'bye' },
      ],
      [],
    )
    const body = JSON.parse(server.lastBody())
    expect(body.messages).toEqual([
      { role: 'system', content: 'You are helpful' },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
      { role: 'user', content: 'bye' },
    ])
    await server.close()
  })

  it('omits tools field when no tools are passed', async () => {
    const server = await startMockServer({
      choices: [{ message: { role: 'assistant', content: 'ok' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    })
    const provider = new OpenAIProvider({
      apiKey: 'test',
      model: 'gpt-4o-mini',
      baseUrl: server.url,
    })
    await provider.resolve([{ role: 'user', content: 'hi' }], [])
    const body = JSON.parse(server.lastBody())
    expect(body.tools).toBeUndefined()
    await server.close()
  })

  it('works without an apiKey (local runner scenario)', async () => {
    const server = await startMockServer({
      choices: [{ message: { role: 'assistant', content: 'hey' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    })
    const provider = new OpenAIProvider({
      model: 'llama3.1',
      baseUrl: server.url,
    })
    const result = await provider.resolve(
      [{ role: 'user', content: 'test' }],
      [],
    )
    expect(result.textContent).toBe('hey')
    await server.close()
  })

  it('falls back to zero tokens when usage is missing', async () => {
    const server = await startMockServer({
      choices: [{ message: { role: 'assistant', content: 'ok' } }],
    })
    const provider = new OpenAIProvider({
      apiKey: 'test',
      model: 'gpt-4o-mini',
      baseUrl: server.url,
    })
    const result = await provider.resolve(
      [{ role: 'user', content: 'test' }],
      [],
    )
    expect(result.tokensIn).toBe(0)
    expect(result.tokensOut).toBe(0)
    await server.close()
  })

  it('chat() returns text + token usage', async () => {
    const server = await startMockServer({
      choices: [
        { message: { role: 'assistant', content: 'Alice는 admin입니다.' }, finish_reason: 'stop' },
      ],
      usage: { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18 },
    })
    const provider = new OpenAIProvider({
      apiKey: 'test',
      model: 'gpt-4o-mini',
      baseUrl: server.url,
    })
    const result = await provider.chat(
      [{ role: 'user', content: '요약해줘' }],
    )
    expect(result.text).toBe('Alice는 admin입니다.')
    expect(result.tokensIn).toBe(12)
    expect(result.tokensOut).toBe(6)
    await server.close()
  })

  it('chat() sends system prompt and max_tokens when provided', async () => {
    const server = await startMockServer({
      choices: [{ message: { role: 'assistant', content: 'ok' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    })
    const provider = new OpenAIProvider({
      apiKey: 'test',
      model: 'gpt-4o-mini',
      baseUrl: server.url,
    })
    await provider.chat(
      [{ role: 'user', content: 'hi' }],
      { system: 'You are a summarizer.', maxTokens: 300 },
    )
    const body = JSON.parse(server.lastBody())
    expect(body.max_tokens).toBe(300)
    expect(body.messages[0]).toEqual({ role: 'system', content: 'You are a summarizer.' })
    expect(body.messages[1]).toEqual({ role: 'user', content: 'hi' })
    expect(body.tools).toBeUndefined()
    await server.close()
  })

  it('chat() defaults max_tokens to 1024 and preserves system message from array', async () => {
    const server = await startMockServer({
      choices: [{ message: { role: 'assistant', content: 'ok' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    })
    const provider = new OpenAIProvider({
      apiKey: 'test',
      model: 'gpt-4o-mini',
      baseUrl: server.url,
    })
    await provider.chat([
      { role: 'system', content: 'existing system' },
      { role: 'user', content: 'hi' },
    ])
    const body = JSON.parse(server.lastBody())
    expect(body.max_tokens).toBe(1024)
    expect(body.messages[0]).toEqual({ role: 'system', content: 'existing system' })
    await server.close()
  })

  it('chat() returns empty text when model produces no content', async () => {
    const server = await startMockServer({
      choices: [{ message: { role: 'assistant', content: null } }],
      usage: { prompt_tokens: 1, completion_tokens: 0 },
    })
    const provider = new OpenAIProvider({
      apiKey: 'test',
      model: 'gpt-4o-mini',
      baseUrl: server.url,
    })
    const result = await provider.chat([{ role: 'user', content: 'hi' }])
    expect(result.text).toBe('')
    await server.close()
  })
})

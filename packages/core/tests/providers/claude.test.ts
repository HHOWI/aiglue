import { describe, it, expect } from 'vitest'
import { createServer, type Server } from 'http'
import { ClaudeProvider } from '../../src/providers/claude.js'

interface MockServer {
  url: string
  close: () => Promise<void>
  lastBody: () => string
  lastPath: () => string
}

function startMockServer(response: unknown): Promise<MockServer> {
  let lastBody = ''
  let lastPath = ''
  return new Promise((resolvePromise) => {
    const server: Server = createServer((req, res) => {
      let body = ''
      req.on('data', (c) => {
        body += c
      })
      req.on('end', () => {
        lastBody = body
        lastPath = req.url ?? ''
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify(response))
      })
    })
    server.listen(0, () => {
      const addr = server.address()
      if (!addr || typeof addr === 'string') throw new Error('bad addr')
      resolvePromise({
        url: `http://localhost:${addr.port}`,
        close: () =>
          new Promise<void>((r) => {
            server.close(() => r())
          }),
        lastBody: () => lastBody,
        lastPath: () => lastPath,
      })
    })
  })
}

describe('ClaudeProvider.chat()', () => {
  it('returns text + token usage', async () => {
    const server = await startMockServer({
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: '요약된 결과' }],
      usage: { input_tokens: 10, output_tokens: 4 },
    })
    const provider = new ClaudeProvider('test-key', 'claude-sonnet-4-20250514')
    // @ts-expect-error — override baseURL for the test
    provider['client'].baseURL = server.url
    const result = await provider.chat([{ role: 'user', content: '요약해줘' }])
    expect(result.text).toBe('요약된 결과')
    expect(result.tokensIn).toBe(10)
    expect(result.tokensOut).toBe(4)
    await server.close()
  })

  it('sends system prompt and max_tokens when provided', async () => {
    const server = await startMockServer({
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 1, output_tokens: 1 },
    })
    const provider = new ClaudeProvider('test-key')
    // @ts-expect-error — override baseURL for the test
    provider['client'].baseURL = server.url
    await provider.chat(
      [{ role: 'user', content: 'hi' }],
      { system: 'You are a summarizer.', maxTokens: 300 },
    )
    const body = JSON.parse(server.lastBody())
    expect(body.max_tokens).toBe(300)
    expect(body.system).toBe('You are a summarizer.')
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }])
    expect(body.tools).toBeUndefined()
    await server.close()
  })

  it('defaults max_tokens to 1024 and uses system from messages array when opts.system absent', async () => {
    const server = await startMockServer({
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 1, output_tokens: 1 },
    })
    const provider = new ClaudeProvider('test-key')
    // @ts-expect-error — override baseURL for the test
    provider['client'].baseURL = server.url
    await provider.chat([
      { role: 'system', content: 'existing system' },
      { role: 'user', content: 'hi' },
    ])
    const body = JSON.parse(server.lastBody())
    expect(body.max_tokens).toBe(1024)
    expect(body.system).toBe('existing system')
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }])
    await server.close()
  })

  it('returns empty text when content array has no text blocks', async () => {
    const server = await startMockServer({
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      content: [],
      usage: { input_tokens: 1, output_tokens: 0 },
    })
    const provider = new ClaudeProvider('test-key')
    // @ts-expect-error — override baseURL for the test
    provider['client'].baseURL = server.url
    const result = await provider.chat([{ role: 'user', content: 'hi' }])
    expect(result.text).toBe('')
    await server.close()
  })
})

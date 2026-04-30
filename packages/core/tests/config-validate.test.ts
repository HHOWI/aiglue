import { describe, it, expect, vi } from 'vitest'
import { validateAIEngineConfig } from '../src/config-validate.js'
import { defineTool } from '../src/define-tool.js'
import type { AIEngineConfig } from '../src/types.js'

const tool = defineTool({ name: 'a', description: 'a', endpoint: 'GET /a' })

const valid: AIEngineConfig = {
  tools: [tool],
  llm: { provider: 'claude', apiKey: 'k' },
}

describe('validateAIEngineConfig', () => {
  it('accepts a minimal valid config', () => {
    expect(() => validateAIEngineConfig(valid)).not.toThrow()
  })

  it('accepts tools as an array of ToolDefinition', () => {
    expect(() => validateAIEngineConfig({ tools: [tool] })).not.toThrow()
  })

  it('rejects tools as a string (yaml path no longer supported)', () => {
    expect(() => validateAIEngineConfig({ tools: 'tools.yaml' as unknown as AIEngineConfig['tools'] }))
      .toThrow(/tools must be an array/)
  })

  it('accepts every documented key on the root and nested objects', () => {
    expect(() =>
      validateAIEngineConfig({
        tools: [tool],
        domainDocs: 'docs',
        llm: { provider: 'claude', apiKey: 'k', model: 'x', baseUrl: 'y', keyMode: 'server', timeoutMs: 1 },
        auth: { type: 'bearer', token: 't' },
        rateLimiting: { global: '60/min', perUser: '10/min' },
        baseUrl: 'http://localhost',
        history: { maxMessages: 10, maxTokens: 4000 },
        messages: {
          internalError: 'err',
          upstreamError: 'err',
        },
        executor: { timeoutMs: 1000, maxResponseBytes: 1024 },
        disposeOnSignal: true,
      }),
    ).not.toThrow()
  })

  it('rejects unknown root key with a helpful error', () => {
    const bad = { ...valid, baseUlr: 'oops' } as unknown as AIEngineConfig
    expect(() => validateAIEngineConfig(bad)).toThrow(/Unknown key "baseUlr" in AIEngineConfig/)
  })

  it('rejects misspelled nested key (executor.timoutMs)', () => {
    const bad = {
      ...valid,
      executor: { timoutMs: 1000 },
    } as unknown as AIEngineConfig
    expect(() => validateAIEngineConfig(bad)).toThrow(/Unknown key "timoutMs" in AIEngineConfig\.executor/)
  })

  it('rejects misspelled nested key (history.maxToken — singular)', () => {
    const bad = {
      ...valid,
      history: { maxToken: 4000 },
    } as unknown as AIEngineConfig
    expect(() => validateAIEngineConfig(bad)).toThrow(/Unknown key "maxToken" in AIEngineConfig\.history/)
  })

  it('rejects null / non-object configs early', () => {
    expect(() => validateAIEngineConfig(null as unknown as AIEngineConfig)).toThrow()
    expect(() => validateAIEngineConfig('config' as unknown as AIEngineConfig)).toThrow()
  })

  it('warns but does not throw when tools array is empty', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => validateAIEngineConfig({ tools: [] })).not.toThrow()
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('no tools defined'))
    spy.mockRestore()
  })

  it('rejects a tool with empty-string name', () => {
    const bad = { tools: [{ name: '', description: 'x', endpoint: 'GET /x' }] } as unknown as AIEngineConfig
    expect(() => validateAIEngineConfig(bad))
      .toThrow(/must be ToolDefinition objects/)
  })
})

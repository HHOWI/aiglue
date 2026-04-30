import { describe, it, expect } from 'vitest'
import { createAIEngine } from '../src/engine.js'
import { defineTool } from '../src/define-tool.js'

const sampleTools = [
  defineTool({
    name: 'get_users',
    description: '사용자 목록을 조회한다',
    endpoint: 'GET /api/users',
    responseType: 'table',
    riskLevel: 'read',
    columns: [{ key: 'id', label: 'ID' }],
  }),
]

describe('engine provider dispatch', () => {
  it('creates an engine when provider is openai-compatible', () => {
    const engine = createAIEngine({
      tools: sampleTools,
      llm: {
        provider: 'openai-compatible',
        apiKey: 'test',
        model: 'gpt-4o-mini',
      },
    })
    expect(engine).toBeDefined()
    expect(typeof engine.processMessage).toBe('function')
  })

  it('creates an engine when provider is openai-compatible without apiKey', () => {
    const engine = createAIEngine({
      tools: sampleTools,
      llm: {
        provider: 'openai-compatible',
        model: 'llama3.1',
        baseUrl: 'http://localhost:11434/v1',
      },
    })
    expect(engine).toBeDefined()
  })

  it('throws when openai-compatible provider is configured without a model', () => {
    expect(() =>
      createAIEngine({
        tools: sampleTools,
        llm: {
          provider: 'openai-compatible',
          apiKey: 'test',
        },
      }),
    ).toThrow(/model/)
  })

  it('still creates a Claude engine when provider is claude', () => {
    const engine = createAIEngine({
      tools: sampleTools,
      llm: { provider: 'claude', apiKey: 'test-key' },
    })
    expect(engine).toBeDefined()
  })
})

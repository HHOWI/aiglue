import { describe, it, expect } from 'vitest'
import { resolve } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { createAIEngine } from '../src/engine.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const fixturePath = resolve(__dirname, 'fixtures/sample-tools.yaml')

describe('engine provider dispatch', () => {
  it('creates an engine when provider is openai-compatible', () => {
    const engine = createAIEngine({
      tools: fixturePath,
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
      tools: fixturePath,
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
        tools: fixturePath,
        llm: {
          provider: 'openai-compatible',
          apiKey: 'test',
        },
      }),
    ).toThrow(/model/)
  })

  it('still creates a Claude engine when provider is claude', () => {
    const engine = createAIEngine({
      tools: fixturePath,
      llm: { provider: 'claude', apiKey: 'test-key' },
    })
    expect(engine).toBeDefined()
  })
})

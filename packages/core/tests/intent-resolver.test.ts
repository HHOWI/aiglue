import { describe, it, expect, vi } from 'vitest'
import { IntentResolver } from '../src/intent-resolver.js'
import type { LLMProvider } from '../src/providers/types.js'
import type { LLMResponse } from '../src/types.js'
import { ToolRegistry } from '../src/tool-registry.js'
import { resolve } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const fixturePath = resolve(__dirname, 'fixtures/sample-tools.yaml')

function createMockProvider(response: LLMResponse): LLMProvider {
  return {
    resolve: vi.fn().mockResolvedValue(response),
  }
}

describe('IntentResolver', () => {
  it('should resolve a natural language query to a tool call', async () => {
    const registry = ToolRegistry.fromFile(fixturePath)
    const mockProvider = createMockProvider({
      toolCall: { toolName: 'get_users', params: {} },
      textContent: null,
      tokensIn: 500,
      tokensOut: 50,
    })
    const resolver = new IntentResolver(mockProvider, registry)

    const result = await resolver.resolve('사용자 목록 보여줘')

    expect(result.toolCall).toEqual({ toolName: 'get_users', params: {} })
    expect(mockProvider.resolve).toHaveBeenCalledOnce()
  })

  it('should return text when LLM does not call a tool', async () => {
    const registry = ToolRegistry.fromFile(fixturePath)
    const mockProvider = createMockProvider({
      toolCall: null,
      textContent: '무엇을 도와드릴까요?',
      tokensIn: 500,
      tokensOut: 30,
    })
    const resolver = new IntentResolver(mockProvider, registry)

    const result = await resolver.resolve('안녕')

    expect(result.toolCall).toBeNull()
    expect(result.textContent).toBe('무엇을 도와드릴까요?')
  })

  it('should include tool definitions from registry in LLM call', async () => {
    const registry = ToolRegistry.fromFile(fixturePath)
    const mockProvider = createMockProvider({
      toolCall: null,
      textContent: 'ok',
      tokensIn: 500,
      tokensOut: 10,
    })
    const resolver = new IntentResolver(mockProvider, registry)

    await resolver.resolve('test')

    const call = vi.mocked(mockProvider.resolve).mock.calls[0]
    const tools = call[1]
    expect(tools).toHaveLength(3)
    expect(tools[0].name).toBe('get_users')
  })
})

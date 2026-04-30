import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import { IntentResolver } from '../src/intent-resolver.js'
import type { LLMProvider } from '../src/providers/types.js'
import type { LLMResponse, ToolDefinition } from '../src/types.js'
import { ToolRegistry } from '../src/tool-registry.js'

/** 3-tool fixture — mirrors the shape of sample-tools.yaml for count-sensitive tests. */
const SAMPLE_TOOLS: ToolDefinition[] = [
  {
    name: 'get_users',
    description: 'Get all users',
    endpoint: 'GET /api/users',
    responseType: 'table',
    columns: [
      { key: 'id', label: 'ID' },
      { key: 'name', label: 'Name' },
    ],
  },
  {
    name: 'get_user',
    description: 'Get a single user by ID',
    endpoint: 'GET /api/users/:id',
    params: z.object({ id: z.string() }),
  },
  {
    name: 'create_user',
    description: 'Create a new user',
    endpoint: 'POST /api/users',
    riskLevel: 'write',
    confirmMessage: '사용자를 생성합니다. 진행할까요?',
  },
]

function createRegistry() {
  return ToolRegistry.fromTools(SAMPLE_TOOLS)
}

function createMockProvider(response: LLMResponse): LLMProvider {
  return {
    resolve: vi.fn().mockResolvedValue(response),
    chat: vi.fn(),
  }
}

describe('IntentResolver', () => {
  it('should resolve a natural language query to a tool call', async () => {
    const registry = createRegistry()
    const mockProvider = createMockProvider({
      toolCalls: [{ toolName: 'get_users', params: {} }],
      textContent: null,
      tokensIn: 500,
      tokensOut: 50,
    })
    const resolver = new IntentResolver(mockProvider, registry)

    const result = await resolver.resolve('사용자 목록 보여줘')

    expect(result.toolCalls).toEqual([{ toolName: 'get_users', params: {} }])
    expect(mockProvider.resolve).toHaveBeenCalledOnce()
  })

  it('should return text when LLM does not call a tool', async () => {
    const registry = createRegistry()
    const mockProvider = createMockProvider({
      toolCalls: [],
      textContent: '무엇을 도와드릴까요?',
      tokensIn: 500,
      tokensOut: 30,
    })
    const resolver = new IntentResolver(mockProvider, registry)

    const result = await resolver.resolve('안녕')

    expect(result.toolCalls).toHaveLength(0)
    expect(result.textContent).toBe('무엇을 도와드릴까요?')
  })

  it('should include tool definitions from registry plus the clarify meta tool in the LLM call', async () => {
    const registry = createRegistry()
    const mockProvider = createMockProvider({
      toolCalls: [],
      textContent: 'ok',
      tokensIn: 500,
      tokensOut: 10,
    })
    const resolver = new IntentResolver(mockProvider, registry)

    await resolver.resolve('test')

    const call = vi.mocked(mockProvider.resolve).mock.calls[0]
    const tools = call[1]
    // 3 user tools from SAMPLE_TOOLS + 1 reserved clarify meta tool the resolver injects.
    expect(tools).toHaveLength(4)
    expect(tools.map((t) => t.name)).toContain('get_users')
    expect(tools.map((t) => t.name)).toContain('__aiglue_clarify__')
  })

  it('should return two tool calls when LLM emits parallel calls', async () => {
    const registry = createRegistry()
    const mockProvider = createMockProvider({
      toolCalls: [
        { toolName: 'get_users', params: {} },
        { toolName: 'get_user', params: { id: '1' } },
      ],
      textContent: null,
      tokensIn: 600,
      tokensOut: 80,
    })
    const resolver = new IntentResolver(mockProvider, registry)

    const result = await resolver.resolve('사용자 목록과 ID 1번 사용자 정보를 같이 보여줘')

    expect(result.toolCalls).toHaveLength(2)
    expect(result.toolCalls[0].toolName).toBe('get_users')
    expect(result.toolCalls[1].toolName).toBe('get_user')
  })

  it('should return only the clarify call when clarify is first and parallel calls are present', async () => {
    const registry = createRegistry()
    const mockProvider = createMockProvider({
      toolCalls: [
        { toolName: '__aiglue_clarify__', params: { question: '어떤 사용자를 말씀하시나요?' } },
        { toolName: 'get_users', params: {} },
      ],
      textContent: null,
      tokensIn: 500,
      tokensOut: 60,
    })
    const resolver = new IntentResolver(mockProvider, registry)

    const result = await resolver.resolve('그 사용자 보여줘')

    // Clarify takes precedence; parallel sibling calls are suppressed.
    expect(result.toolCalls).toHaveLength(1)
    expect(result.toolCalls[0].toolName).toBe('__aiglue_clarify__')
  })

  it('should return single clarify call when LLM emits clarify alone', async () => {
    const registry = createRegistry()
    const mockProvider = createMockProvider({
      toolCalls: [
        { toolName: '__aiglue_clarify__', params: { question: '무엇을 도와드릴까요?', options: ['목록 조회', '상세 조회'] } },
      ],
      textContent: null,
      tokensIn: 500,
      tokensOut: 60,
    })
    const resolver = new IntentResolver(mockProvider, registry)

    const result = await resolver.resolve('뭔가 보여줘')

    expect(result.toolCalls).toHaveLength(1)
    expect(result.toolCalls[0].toolName).toBe('__aiglue_clarify__')
    expect(result.toolCalls[0].params.question).toBe('무엇을 도와드릴까요?')
  })
})

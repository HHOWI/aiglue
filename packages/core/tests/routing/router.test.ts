import { describe, it, expect, vi } from 'vitest'
import { Router } from '../../src/routing/router.js'
import { ToolRegistry } from '../../src/tool-registry.js'
import { defineTool } from '../../src/define-tool.js'
import type { LLMProvider } from '../../src/providers/types.js'
import { z } from 'zod'

function makeProvider(impl: Partial<LLMProvider>): LLMProvider {
  return {
    resolve: vi.fn(),
    chat: vi.fn(),
    ...impl,
  } as LLMProvider
}

// Sample tools equivalent to the old sample-tools.yaml fixture
const sampleTools = [
  defineTool({
    name: 'get_users',
    description: '사용자 목록을 조회한다',
    endpoint: 'GET /api/users',
    responseType: 'table',
    riskLevel: 'read',
    columns: [{ key: 'id', label: 'ID' }],
    examples: ['사용자 목록 보여줘', '관리자 목록'],
  }),
  defineTool({
    name: 'update_user',
    description: '사용자 정보를 수정한다',
    endpoint: 'PUT /api/users/:id',
    params: z.object({ id: z.string() }),
    riskLevel: 'write',
    confirmMessage: '사용자 정보를 수정합니다. 진행할까요?',
  }),
  defineTool({
    name: 'delete_user',
    description: '사용자를 삭제한다',
    endpoint: 'DELETE /api/users/:id',
    params: z.object({ id: z.string() }),
    riskLevel: 'critical',
    confirmMessage: '사용자를 삭제합니다. 이 작업은 되돌릴 수 없습니다.',
  }),
]

describe('Router — single strategy', () => {
  it('returns the full tool list and never calls the LLM in explicit single mode', async () => {
    const registry = ToolRegistry.fromTools(sampleTools)
    const provider = makeProvider({})
    const router = new Router(provider, registry, { strategy: 'single' })

    const result = await router.decide('show users', [])

    expect(result.tools).toHaveLength(registry.getAllTools().length)
    expect(result.tokensIn).toBe(0)
    expect(result.tokensOut).toBe(0)
    expect(result.fellBack).toBe(false)
    expect(provider.resolve).not.toHaveBeenCalled()
  })
})

describe('Router — auto strategy (default)', () => {
  it('uses single-stage for catalogs below the threshold', async () => {
    const registry = ToolRegistry.fromTools(sampleTools) // 3 tools
    const provider = makeProvider({})
    const router = new Router(provider, registry, { strategy: 'auto', twoStageThreshold: 30 })

    const result = await router.decide('hi', [])

    expect(result.tools).toHaveLength(registry.getAllTools().length)
    expect(provider.resolve).not.toHaveBeenCalled()
  })

  it('uses two-stage at or above the threshold', async () => {
    // Build a registry with exactly threshold tools so the >= boundary fires.
    const fakeTools = Array.from({ length: 4 }, (_, i) => defineTool({
      name: `tool_${i}`,
      description: `tool ${i}`,
      endpoint: `GET /api/${i}`,
      riskLevel: 'read',
    }))
    const registry = ToolRegistry.fromTools(fakeTools)
    const resolveMock = vi.fn().mockResolvedValue({
      toolCalls: [{ toolName: 'select_tools', params: { names: ['tool_1'] } }],
      textContent: null,
      tokensIn: 20,
      tokensOut: 5,
    })
    const router = new Router(makeProvider({ resolve: resolveMock }), registry, {
      strategy: 'auto',
      twoStageThreshold: 4,
    })

    const result = await router.decide('do tool 1', [])

    expect(resolveMock).toHaveBeenCalled()
    expect(result.tools.map((t) => t.name)).toEqual(['tool_1'])
    expect(result.tokensIn).toBe(20)
  })

  it('uses the default threshold of 30 when none is supplied', async () => {
    // 3-tool registry should resolve to single under the default 30 threshold.
    const registry = ToolRegistry.fromTools(sampleTools)
    const provider = makeProvider({})
    const router = new Router(provider, registry) // no config — full defaults

    const result = await router.decide('anything', [])
    expect(result.tools).toHaveLength(registry.getAllTools().length)
    expect(provider.resolve).not.toHaveBeenCalled()
  })
})

describe('Router — two-stage strategy', () => {
  it('forwards only the names selected by the stage-1 LLM', async () => {
    const registry = ToolRegistry.fromTools(sampleTools)
    const resolveMock = vi.fn().mockResolvedValue({
      toolCalls: [{ toolName: 'select_tools', params: { names: ['get_users'] } }],
      textContent: null,
      tokensIn: 50,
      tokensOut: 10,
    })
    const router = new Router(makeProvider({ resolve: resolveMock }), registry, { strategy: 'two-stage' })

    const result = await router.decide('show users', [])

    expect(result.tools.map((t) => t.name)).toEqual(['get_users'])
    expect(result.tokensIn).toBe(50)
    expect(result.tokensOut).toBe(10)
    expect(result.fellBack).toBe(false)
    // The router must use the meta tool, not the actual tools, for the routing call.
    const metaToolsArg = resolveMock.mock.calls[0][1] as Array<{ name: string }>
    expect(metaToolsArg.map((t) => t.name)).toEqual(['select_tools'])
  })

  it('falls back to the full catalog when stage 1 returns no tool calls', async () => {
    const registry = ToolRegistry.fromTools(sampleTools)
    const resolveMock = vi.fn().mockResolvedValue({
      toolCalls: [],
      textContent: 'I am not sure',
      tokensIn: 30,
      tokensOut: 5,
    })
    const router = new Router(makeProvider({ resolve: resolveMock }), registry, { strategy: 'two-stage' })

    const result = await router.decide('vague request', [])

    expect(result.tools).toHaveLength(registry.getAllTools().length)
    expect(result.tokensIn).toBe(30) // stage-1 cost is still counted
    expect(result.fellBack).toBe(true)
  })

  it('falls back when stage 1 returns names that do not exist in the registry', async () => {
    const registry = ToolRegistry.fromTools(sampleTools)
    const resolveMock = vi.fn().mockResolvedValue({
      toolCalls: [{ toolName: 'select_tools', params: { names: ['delete_universe', 'launch_rocket'] } }],
      textContent: null,
      tokensIn: 40,
      tokensOut: 8,
    })
    const router = new Router(makeProvider({ resolve: resolveMock }), registry, { strategy: 'two-stage' })

    const result = await router.decide('do something nonsense', [])

    expect(result.tools).toHaveLength(registry.getAllTools().length)
    expect(result.fellBack).toBe(true)
  })

  it('drops invalid names but keeps valid ones in a mixed response', async () => {
    const registry = ToolRegistry.fromTools(sampleTools)
    const resolveMock = vi.fn().mockResolvedValue({
      toolCalls: [{ toolName: 'select_tools', params: { names: ['get_users', 'phantom_tool'] } }],
      textContent: null,
      tokensIn: 40,
      tokensOut: 8,
    })
    const router = new Router(makeProvider({ resolve: resolveMock }), registry, { strategy: 'two-stage' })

    const result = await router.decide('mixed request', [])

    expect(result.tools.map((t) => t.name)).toEqual(['get_users'])
    expect(result.fellBack).toBe(false)
  })

  it('falls back to the full catalog when the stage-1 LLM call throws', async () => {
    const registry = ToolRegistry.fromTools(sampleTools)
    const resolveMock = vi.fn().mockRejectedValue(new Error('LLM timeout'))
    const router = new Router(makeProvider({ resolve: resolveMock }), registry, { strategy: 'two-stage' })

    const result = await router.decide('something', [])

    expect(result.tools).toHaveLength(registry.getAllTools().length)
    expect(result.fellBack).toBe(true)
    expect(result.tokensIn).toBe(0) // failure before billing
  })
})

describe('ToolRegistry.toIndex()', () => {
  it('produces one entry per tool with a short description and ≤2 examples', () => {
    const registry = ToolRegistry.fromTools(sampleTools)
    const index = registry.toIndex()
    expect(index.length).toBe(registry.getAllTools().length)
    for (const entry of index) {
      expect(entry.shortDescription.length).toBeLessThanOrEqual(81)
      expect(entry.examples.length).toBeLessThanOrEqual(2)
    }
  })

  it('caches the result by reference (registry is immutable after fromTools)', () => {
    const registry = ToolRegistry.fromTools(sampleTools)
    expect(registry.toIndex()).toBe(registry.toIndex())
  })
})

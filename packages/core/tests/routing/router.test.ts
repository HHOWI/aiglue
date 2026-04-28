import { describe, it, expect, vi } from 'vitest'
import { resolve } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { Router } from '../../src/routing/router.js'
import { ToolRegistry } from '../../src/tool-registry.js'
import type { LLMProvider } from '../../src/providers/types.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const fixturePath = resolve(__dirname, '../fixtures/sample-tools.yaml')

function makeProvider(impl: Partial<LLMProvider>): LLMProvider {
  return {
    resolve: vi.fn(),
    chat: vi.fn(),
    ...impl,
  } as LLMProvider
}

describe('Router — single strategy', () => {
  it('returns the full tool list and never calls the LLM in explicit single mode', async () => {
    const registry = ToolRegistry.fromFile(fixturePath)
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
    const registry = ToolRegistry.fromFile(fixturePath) // sample fixture has 3 tools
    const provider = makeProvider({})
    const router = new Router(provider, registry, { strategy: 'auto', twoStageThreshold: 30 })

    const result = await router.decide('hi', [])

    expect(result.tools).toHaveLength(registry.getAllTools().length)
    expect(provider.resolve).not.toHaveBeenCalled()
  })

  it('uses two-stage at or above the threshold', async () => {
    // Build a registry with exactly threshold tools so the >= boundary fires.
    const fakeTools = Array.from({ length: 4 }, (_, i) => ({
      name: `tool_${i}`,
      description: `tool ${i}`,
      endpoint: `GET /api/${i}`,
    }))
    const registry = ToolRegistry.fromConfig({
      tools_yaml_version: '1.0',
      tools: fakeTools,
    })
    const resolveMock = vi.fn().mockResolvedValue({
      toolCall: { toolName: 'select_tools', params: { names: ['tool_1'] } },
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
    // 3-tool fixture should resolve to single under the default 30 threshold.
    const registry = ToolRegistry.fromFile(fixturePath)
    const provider = makeProvider({})
    const router = new Router(provider, registry) // no config — full defaults

    const result = await router.decide('anything', [])
    expect(result.tools).toHaveLength(registry.getAllTools().length)
    expect(provider.resolve).not.toHaveBeenCalled()
  })
})

describe('Router — two-stage strategy', () => {
  it('forwards only the names selected by the stage-1 LLM', async () => {
    const registry = ToolRegistry.fromFile(fixturePath)
    const resolveMock = vi.fn().mockResolvedValue({
      toolCall: { toolName: 'select_tools', params: { names: ['get_users'] } },
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

  it('falls back to the full catalog when stage 1 returns no tool_call', async () => {
    const registry = ToolRegistry.fromFile(fixturePath)
    const resolveMock = vi.fn().mockResolvedValue({
      toolCall: null,
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
    const registry = ToolRegistry.fromFile(fixturePath)
    const resolveMock = vi.fn().mockResolvedValue({
      toolCall: { toolName: 'select_tools', params: { names: ['delete_universe', 'launch_rocket'] } },
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
    const registry = ToolRegistry.fromFile(fixturePath)
    const resolveMock = vi.fn().mockResolvedValue({
      toolCall: { toolName: 'select_tools', params: { names: ['get_users', 'phantom_tool'] } },
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
    const registry = ToolRegistry.fromFile(fixturePath)
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
    const registry = ToolRegistry.fromFile(fixturePath)
    const index = registry.toIndex()
    expect(index.length).toBe(registry.getAllTools().length)
    for (const entry of index) {
      expect(entry.shortDescription.length).toBeLessThanOrEqual(81)
      expect(entry.examples.length).toBeLessThanOrEqual(2)
    }
  })

  it('caches the result by reference (registry is immutable until reload)', () => {
    const registry = ToolRegistry.fromFile(fixturePath)
    expect(registry.toIndex()).toBe(registry.toIndex())
  })
})

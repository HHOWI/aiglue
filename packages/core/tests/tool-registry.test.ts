import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { ToolRegistry } from '../src/tool-registry.js'
import { defineTool } from '../src/define-tool.js'

const listUsers = defineTool({
  name: 'list_users',
  description: 'List users',
  endpoint: 'GET /users',
  params: z.object({ limit: z.number().describe('Max rows').optional() }),
  examples: ['show users', 'list everyone'],
})

describe('ToolRegistry.fromTools', () => {
  it('builds a registry from an array of definitions', () => {
    const reg = ToolRegistry.fromTools([listUsers])
    expect(reg.getToolNames()).toEqual(['list_users'])
    expect(reg.hasTool('list_users')).toBe(true)
  })

  it('throws on duplicate names', () => {
    expect(() => ToolRegistry.fromTools([listUsers, listUsers]))
      .toThrow(/Duplicate tool name "list_users"/)
  })

  it('toLLMTools produces JSON Schema params via zod-to-json-schema', () => {
    const reg = ToolRegistry.fromTools([listUsers])
    const [tool] = reg.toLLMTools()
    expect(tool.name).toBe('list_users')
    expect(tool.parameters).toMatchObject({
      type: 'object',
      properties: { limit: { type: 'number', description: 'Max rows' } },
    })
    expect(tool.description).toContain('Example queries: show users, list everyone')
  })

  it('toIndex emits short descriptions and example slices', () => {
    const reg = ToolRegistry.fromTools([listUsers])
    const [entry] = reg.toIndex()
    expect(entry).toMatchObject({
      name: 'list_users',
      shortDescription: 'List users',
      examples: ['show users', 'list everyone'],
    })
  })

  it('getTool returns the definition or undefined', () => {
    const reg = ToolRegistry.fromTools([listUsers])
    expect(reg.getTool('list_users')).toBe(listUsers)
    expect(reg.getTool('missing')).toBeUndefined()
  })

  it('getAllTools returns all stored definitions in insertion order', () => {
    const a = defineTool({ name: 'a', description: 'a', endpoint: 'GET /a' })
    const b = defineTool({ name: 'b', description: 'b', endpoint: 'GET /b' })
    const reg = ToolRegistry.fromTools([a, b])
    expect(reg.getAllTools()).toEqual([a, b])
  })

  it('toLLMToolsSubset filters to the requested names', () => {
    const a = defineTool({ name: 'a', description: 'a', endpoint: 'GET /a' })
    const b = defineTool({ name: 'b', description: 'b', endpoint: 'GET /b' })
    const reg = ToolRegistry.fromTools([a, b])
    const subset = reg.toLLMToolsSubset(['a'])
    expect(subset).toHaveLength(1)
    expect(subset[0].name).toBe('a')
  })

  it('toLLMTools and toIndex return the cached reference on repeat calls', () => {
    const reg = ToolRegistry.fromTools([listUsers])
    expect(reg.toLLMTools()).toBe(reg.toLLMTools())
    expect(reg.toIndex()).toBe(reg.toIndex())
  })

  it('parseEndpoint splits METHOD and path', () => {
    const reg = ToolRegistry.fromTools([listUsers])
    expect(reg.parseEndpoint('GET /users/:id')).toEqual({ method: 'GET', path: '/users/:id' })
    expect(reg.parseEndpoint('post /a')).toEqual({ method: 'POST', path: '/a' })
  })

  it('parseEndpoint throws on missing method', () => {
    const reg = ToolRegistry.fromTools([listUsers])
    expect(() => reg.parseEndpoint('/users/:id')).toThrow(/Invalid endpoint format/)
  })
})

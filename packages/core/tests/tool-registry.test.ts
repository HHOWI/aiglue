import { describe, it, expect } from 'vitest'
import { ToolRegistry } from '../src/tool-registry.js'
import { resolve } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const fixturePath = resolve(__dirname, 'fixtures/sample-tools.yaml')

describe('ToolRegistry', () => {
  it('should load tools from yaml file', () => {
    const registry = ToolRegistry.fromFile(fixturePath)
    expect(registry.getToolNames()).toEqual(['get_users', 'update_user', 'delete_user'])
  })

  it('should get a tool by name', () => {
    const registry = ToolRegistry.fromFile(fixturePath)
    const tool = registry.getTool('get_users')
    expect(tool).toBeDefined()
    expect(tool!.description).toBe('사용자 목록을 조회한다')
    expect(tool!.endpoint).toBe('GET /api/users')
    expect(tool!.risk_level).toBe('read')
  })

  it('should return undefined for unknown tool', () => {
    const registry = ToolRegistry.fromFile(fixturePath)
    expect(registry.getTool('nonexistent')).toBeUndefined()
  })

  it('should check if tool exists', () => {
    const registry = ToolRegistry.fromFile(fixturePath)
    expect(registry.hasTool('get_users')).toBe(true)
    expect(registry.hasTool('nonexistent')).toBe(false)
  })

  it('should convert tools to LLM tool definitions', () => {
    const registry = ToolRegistry.fromFile(fixturePath)
    const llmTools = registry.toLLMTools()
    expect(llmTools).toHaveLength(3)
    expect(llmTools[0].name).toBe('get_users')
    expect(llmTools[0].description).toContain('사용자 목록을 조회한다')
    expect(llmTools[0].parameters).toHaveProperty('properties')
  })

  it('should parse endpoint into method and path', () => {
    const registry = ToolRegistry.fromFile(fixturePath)
    const tool = registry.getTool('get_users')!
    const { method, path } = registry.parseEndpoint(tool.endpoint)
    expect(method).toBe('GET')
    expect(path).toBe('/api/users')
  })

  it('should throw on invalid yaml', () => {
    expect(() => ToolRegistry.fromFile('/nonexistent/path.yaml')).toThrow()
  })

  it('should include examples in LLM tool description', () => {
    const registry = ToolRegistry.fromFile(fixturePath)
    const llmTools = registry.toLLMTools()
    const getUsersTool = llmTools.find(t => t.name === 'get_users')!
    expect(getUsersTool.description).toContain('사용자 목록 보여줘')
  })
})

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

  it('should throw when two tools share the same name', () => {
    expect(() =>
      ToolRegistry.fromConfig({
        tools_yaml_version: '1.0',
        tools: [
          { name: 'get_users', description: 'First', endpoint: 'GET /api/users' },
          { name: 'get_users', description: 'Second (duplicate)', endpoint: 'GET /api/users/v2' },
        ],
      })
    ).toThrow('Duplicate tool name "get_users"')
  })

  it('should return the same array reference on repeated toLLMTools() calls', () => {
    const registry = ToolRegistry.fromFile(fixturePath)
    const first = registry.toLLMTools()
    const second = registry.toLLMTools()
    expect(first).toBe(second)
  })

  it('should include examples in LLM tool description', () => {
    const registry = ToolRegistry.fromFile(fixturePath)
    const llmTools = registry.toLLMTools()
    const getUsersTool = llmTools.find(t => t.name === 'get_users')!
    expect(getUsersTool.description).toContain('사용자 목록 보여줘')
  })

  it('loadFromFile() swaps tools atomically and invalidates the LLM-tools cache', async () => {
    const { writeFileSync, mkdtempSync, rmSync } = await import('fs')
    const { tmpdir } = await import('os')
    const dir = mkdtempSync(resolve(tmpdir(), 'aiglue-reload-'))
    const path = resolve(dir, 'tools.yaml')

    writeFileSync(path, `tools_yaml_version: "1.0"
tools:
  - name: alpha
    description: alpha
    endpoint: GET /api/a
`)

    const reg = ToolRegistry.fromFile(path)
    expect(reg.getToolNames()).toEqual(['alpha'])
    const llmFirst = reg.toLLMTools()
    expect(llmFirst).toHaveLength(1)

    writeFileSync(path, `tools_yaml_version: "1.0"
tools:
  - name: alpha
    description: alpha
    endpoint: GET /api/a
  - name: beta
    description: beta
    endpoint: GET /api/b
`)
    reg.loadFromFile(path)
    expect(reg.getToolNames()).toEqual(['alpha', 'beta'])
    const llmSecond = reg.toLLMTools()
    expect(llmSecond).toHaveLength(2)
    expect(llmSecond).not.toBe(llmFirst) // cache invalidated

    rmSync(dir, { recursive: true, force: true })
  })

  it('loadFromFile() preserves existing tools when the new file is invalid', async () => {
    const { writeFileSync, mkdtempSync, rmSync } = await import('fs')
    const { tmpdir } = await import('os')
    const dir = mkdtempSync(resolve(tmpdir(), 'aiglue-reload-bad-'))
    const path = resolve(dir, 'tools.yaml')
    writeFileSync(path, `tools_yaml_version: "1.0"
tools:
  - name: alpha
    description: alpha
    endpoint: GET /api/a
`)
    const reg = ToolRegistry.fromFile(path)

    // Write a YAML that parses but violates duplicate-name rule
    writeFileSync(path, `tools_yaml_version: "1.0"
tools:
  - name: dup
    description: x
    endpoint: GET /api/x
  - name: dup
    description: y
    endpoint: GET /api/y
`)
    expect(() => reg.loadFromFile(path)).toThrow('Duplicate tool name')
    // Original tools are intact — atomic swap means failed loads roll back.
    expect(reg.getToolNames()).toEqual(['alpha'])

    rmSync(dir, { recursive: true, force: true })
  })
})

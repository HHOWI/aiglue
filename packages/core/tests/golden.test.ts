import { describe, it, expect } from 'vitest'
import { ToolRegistry } from '../src/tool-registry.js'
import { resolve } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const erutPath = resolve(__dirname, 'fixtures/erut-tools.yaml')

describe('Golden Tests — ERUT tools.yaml', () => {
  it('should load all 5 ERUT tools', () => {
    const registry = ToolRegistry.fromFile(erutPath)
    expect(registry.getToolNames()).toHaveLength(5)
  })

  it('should have correct LLM tool definitions for alarm list', () => {
    const registry = ToolRegistry.fromFile(erutPath)
    const tools = registry.toLLMTools()
    const alarmTool = tools.find(t => t.name === 'get_alarm_list')!
    expect(alarmTool.description).toContain('알람 목록')
    expect(alarmTool.description).toContain('미확인 알람 보여줘')
    expect(alarmTool.parameters).toHaveProperty('properties.status')
  })

  it('should parse POST endpoints correctly', () => {
    const registry = ToolRegistry.fromFile(erutPath)
    const tool = registry.getTool('get_alarm_list')!
    const { method, path } = registry.parseEndpoint(tool.endpoint)
    expect(method).toBe('POST')
    expect(path).toBe('/api/v0/alarm/list')
  })

  it('should have request_body_template for POST tools', () => {
    const registry = ToolRegistry.fromFile(erutPath)
    const tool = registry.getTool('get_alarm_list')!
    expect(tool.request_body_template).toEqual({ pageNo: 1, pageSize: 50 })
  })

  it('should have response_mapping for table tools', () => {
    const registry = ToolRegistry.fromFile(erutPath)
    const tool = registry.getTool('get_alarm_list')!
    expect(tool.response_mapping?.data_path).toBe('contents.list')
    expect(tool.response_mapping?.total_path).toBe('contents.totalCount')
  })

  it('should require confirmation for write tools', () => {
    const registry = ToolRegistry.fromFile(erutPath)
    const tool = registry.getTool('update_alarm_status')!
    expect(tool.risk_level).toBe('write')
    expect(tool.confirm_message).toBeDefined()
  })
})

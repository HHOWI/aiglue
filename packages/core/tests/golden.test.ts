import { describe, it, expect } from 'vitest'
import { ToolRegistry } from '../src/tool-registry.js'
import { defineTool } from '../src/define-tool.js'
import { z } from 'zod'

// Programmatic equivalent of fixtures/erut-tools.yaml — using code-first API
const erutTools = [
  defineTool({
    name: 'get_alarm_list',
    description: '알람 목록을 조회한다. 장비 통신 문제와 센서 동작 문제 두 종류가 있다.',
    endpoint: 'POST /api/v0/alarm/list',
    params: z.object({ status: z.enum(['UNCHECKED', 'CHECKED', 'RESOLVED']).optional() }),
    requestBodyTemplate: { pageNo: 1, pageSize: 50 },
    responseMapping: { dataPath: 'contents.list', totalPath: 'contents.totalCount' },
    columns: [
      { key: 'alarmId', label: 'ID' },
      { key: 'alarmType', label: '유형', type: 'badge' as const },
      { key: 'status', label: '상태' },
    ],
    responseType: 'table',
    riskLevel: 'read',
    examples: ['미확인 알람 보여줘', '알람 목록'],
  }),
  defineTool({
    name: 'get_alarm_counts',
    description: '알람 상태별 건수를 조회한다.',
    endpoint: 'POST /api/v0/alarm/counts',
    responseType: 'text',
    riskLevel: 'read',
    examples: ['알람 몇 건이야?'],
  }),
  defineTool({
    name: 'get_dashboard',
    description: '전체 현장의 종합 대시보드 데이터를 조회한다.',
    endpoint: 'POST /api/v0/dashboard/dashboard-data',
    responseType: 'text',
    riskLevel: 'read',
    examples: ['전체 현황 요약해줘', '대시보드 보여줘'],
  }),
  defineTool({
    name: 'get_thickness_trend',
    description: '센서의 두께 변화 추이를 시계열로 조회한다.',
    endpoint: 'POST /api/v0/sensor/thickness-trend',
    params: z.object({ sensorId: z.string() }),
    responseType: 'text',
    riskLevel: 'read',
    examples: ['MC-003 두께 트렌드 보여줘'],
  }),
  defineTool({
    name: 'update_alarm_status',
    description: '알람의 처리 상태를 변경한다 (미확인→확인→조치완료).',
    endpoint: 'POST /api/v0/alarm/update',
    riskLevel: 'write',
    confirmMessage: '알람 상태를 변경합니다. 진행할까요?',
  }),
]

describe('Golden Tests — ERUT tools', () => {
  it('should load all 5 ERUT tools', () => {
    const registry = ToolRegistry.fromTools(erutTools)
    expect(registry.getToolNames()).toHaveLength(5)
  })

  it('should have correct LLM tool definitions for alarm list', () => {
    const registry = ToolRegistry.fromTools(erutTools)
    const tools = registry.toLLMTools()
    const alarmTool = tools.find(t => t.name === 'get_alarm_list')!
    expect(alarmTool.description).toContain('알람 목록')
    expect(alarmTool.description).toContain('미확인 알람 보여줘')
    expect(alarmTool.parameters).toHaveProperty('properties.status')
  })

  it('should parse POST endpoints correctly', () => {
    const registry = ToolRegistry.fromTools(erutTools)
    const tool = registry.getTool('get_alarm_list')!
    const { method, path } = registry.parseEndpoint(tool.endpoint)
    expect(method).toBe('POST')
    expect(path).toBe('/api/v0/alarm/list')
  })

  it('should have requestBodyTemplate for POST tools', () => {
    const registry = ToolRegistry.fromTools(erutTools)
    const tool = registry.getTool('get_alarm_list')!
    expect(tool.requestBodyTemplate).toEqual({ pageNo: 1, pageSize: 50 })
  })

  it('should have responseMapping for table tools', () => {
    const registry = ToolRegistry.fromTools(erutTools)
    const tool = registry.getTool('get_alarm_list')!
    expect(tool.responseMapping?.dataPath).toBe('contents.list')
    expect(tool.responseMapping?.totalPath).toBe('contents.totalCount')
  })

  it('should require confirmation for write tools', () => {
    const registry = ToolRegistry.fromTools(erutTools)
    const tool = registry.getTool('update_alarm_status')!
    expect(tool.riskLevel).toBe('write')
    expect(tool.confirmMessage).toBeDefined()
  })
})

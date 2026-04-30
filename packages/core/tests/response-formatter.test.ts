import { describe, it, expect } from 'vitest'
import { ResponseFormatter } from '../src/response-formatter.js'
import type { ToolDefinition } from '../src/types.js'

const tableTool: ToolDefinition = {
  name: 'get_users',
  description: 'Get users',
  endpoint: 'GET /api/users',
  response_type: 'table',
  response_mapping: { data_path: 'data.items', total_path: 'data.total' },
  columns: [
    { key: 'id', label: 'ID' },
    { key: 'name', label: '이름' },
  ],
}

const textTool: ToolDefinition = {
  name: 'get_count',
  description: 'Get count',
  endpoint: 'GET /api/count',
  response_type: 'text',
}

const noTypeTool: ToolDefinition = {
  name: 'do_something',
  description: 'Do something',
  endpoint: 'POST /api/action',
}

describe('ResponseFormatter', () => {
  const formatter = new ResponseFormatter()

  it('should format table response with response_mapping', () => {
    const apiResponse = {
      data: {
        items: [
          { id: 1, name: 'Alice', extra: 'ignored' },
          { id: 2, name: 'Bob', extra: 'ignored' },
        ],
        total: 2,
      },
    }
    const result = formatter.format(tableTool, apiResponse)
    expect(result.type).toBe('table')
    if (result.type === 'table') {
      expect(result.rows).toHaveLength(2)
      expect(result.columns).toEqual(tableTool.columns)
      expect(result.total).toBe(2)
    }
  })

  it('should format text response', () => {
    const result = formatter.format(textTool, { count: 42 })
    expect(result.type).toBe('text')
    if (result.type === 'text') {
      expect(result.content).toContain('42')
    }
  })

  it('should default to text for unknown response_type', () => {
    const result = formatter.format(noTypeTool, { success: true })
    expect(result.type).toBe('text')
  })

  it('should return error when data_path is not found in response', () => {
    const result = formatter.format(tableTool, { wrong: 'shape' })
    expect(result.type).toBe('error')
    if (result.type === 'error') {
      expect(result.code).toBe('DATA_PATH_NOT_FOUND')
      expect(result.message).toContain('data_path')
    }
  })

  it('should return error when data_path resolves to non-array', () => {
    const result = formatter.format(tableTool, { data: { items: 'not-an-array' } })
    expect(result.type).toBe('error')
    if (result.type === 'error') {
      expect(result.code).toBe('DATA_PATH_NOT_ARRAY')
    }
  })

  it('should format action response', () => {
    const result = formatter.formatAction(true, '완료되었습니다')
    expect(result.type).toBe('action')
    if (result.type === 'action') {
      expect(result.status).toBe('success')
      expect(result.message).toBe('완료되었습니다')
    }
  })

  it('should format confirm response', () => {
    const tool: ToolDefinition = {
      name: 'delete_user',
      description: 'Delete user',
      endpoint: 'DELETE /api/users/:id',
      confirm_message: '삭제합니다. 진행할까요?',
    }
    const result = formatter.formatConfirm(tool, { id: '1' })
    expect(result.type).toBe('confirm')
    if (result.type === 'confirm') {
      expect(result.message).toBe('삭제합니다. 진행할까요?')
      expect(result.toolName).toBe('delete_user')
    }
  })

  it('should use explicit message arg over tool.confirm_message in formatConfirm', () => {
    const tool: ToolDefinition = {
      name: 'delete_user',
      description: 'Delete user',
      endpoint: 'DELETE /api/users/:id',
      confirm_message: 'original message',
    }
    const result = formatter.formatConfirm(tool, { id: '1' }, 'override message')
    expect(result.type).toBe('confirm')
    if (result.type === 'confirm') {
      expect(result.message).toBe('override message')
    }
  })

  it('should format error response', () => {
    const result = formatter.formatError('서버 오류', 'API_ERROR')
    expect(result.type).toBe('error')
    if (result.type === 'error') {
      expect(result.code).toBe('API_ERROR')
    }
  })

  it('should handle array response without response_mapping', () => {
    const arrayTool: ToolDefinition = {
      name: 'list',
      description: 'List',
      endpoint: 'GET /api/items',
      response_type: 'table',
      columns: [{ key: 'id', label: 'ID' }],
    }
    const result = formatter.format(arrayTool, [{ id: 1 }, { id: 2 }])
    expect(result.type).toBe('table')
    if (result.type === 'table') {
      expect(result.rows).toHaveLength(2)
    }
  })

  it('should passthrough API response when response_type is raw', () => {
    const rawTool: ToolDefinition = {
      name: 'get_dashboard',
      description: 'Dashboard payload handled by frontend grid',
      endpoint: 'GET /api/dashboard',
      response_type: 'raw',
    }
    const apiResponse = {
      items: [{ id: 1, name: 'Alice' }],
      meta: { total: 1, page: 1 },
      chartSeries: [10, 20, 30],
    }
    const result = formatter.format(rawTool, apiResponse)
    expect(result.type).toBe('raw')
    if (result.type === 'raw') {
      expect(result.data).toBe(apiResponse)
    }
  })

  it('should coerce total_path string value to number', () => {
    const toolWithTotal: ToolDefinition = {
      name: 'list_items',
      description: 'List items',
      endpoint: 'GET /api/items',
      response_type: 'table',
      response_mapping: { data_path: 'data', total_path: 'meta.total' },
      columns: [{ key: 'id', label: 'ID' }],
    }
    const apiResponse = {
      data: [{ id: 1 }],
      meta: { total: '42' },
    }
    const result = formatter.format(toolWithTotal, apiResponse)
    expect(result.type).toBe('table')
    if (result.type === 'table') {
      expect(result.total).toBe(42)
      expect(typeof result.total).toBe('number')
    }
  })

  it('preserves arbitrary shapes (array, primitive) for raw', () => {
    const rawTool: ToolDefinition = {
      name: 'anything',
      description: 'Anything',
      endpoint: 'GET /api/anything',
      response_type: 'raw',
    }
    const arrayResult = formatter.format(rawTool, [1, 2, 3])
    expect(arrayResult.type).toBe('raw')
    if (arrayResult.type === 'raw') {
      expect(arrayResult.data).toEqual([1, 2, 3])
    }
    const stringResult = formatter.format(rawTool, 'hello')
    expect(stringResult.type).toBe('raw')
    if (stringResult.type === 'raw') {
      expect(stringResult.data).toBe('hello')
    }
  })

  it('formatMulti wraps an array of responses', () => {
    const r1 = { type: 'text' as const, content: 'a' }
    const r2 = { type: 'text' as const, content: 'b' }
    const multi = formatter.formatMulti([r1, r2])
    expect(multi).toEqual({ type: 'multi', results: [r1, r2] })
  })
})

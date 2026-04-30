import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { defineTool } from '../src/define-tool.js'

describe('defineTool semantic checks', () => {
  it('accepts a valid read tool', () => {
    expect(() => defineTool({
      name: 'list_users',
      description: 'List users',
      endpoint: 'GET /users',
      params: z.object({ limit: z.number().optional() }),
    })).not.toThrow()
  })

  it('throws on path key not in params (path-key-mismatch)', () => {
    expect(() => defineTool({
      name: 'get_user',
      description: 'Get user',
      endpoint: 'GET /users/:id',
      params: z.object({ name: z.string() }),
    })).toThrow(/path-key-mismatch.*'id'/)
  })

  it('throws on write tool without confirmMessage (confirm-required-on-write)', () => {
    expect(() => defineTool({
      name: 'delete_user',
      description: 'Delete user',
      endpoint: 'DELETE /users/:id',
      params: z.object({ id: z.string() }),
      riskLevel: 'write',
    })).toThrow(/confirm-required/)
  })

  it('throws on table responseType without columns (table-needs-columns)', () => {
    expect(() => defineTool({
      name: 'list_users',
      description: 'List',
      endpoint: 'GET /users',
      responseType: 'table',
    })).toThrow(/table-needs-columns/)
  })

  it('throws on summary without dataPath or columns (summary-requires-table)', () => {
    expect(() => defineTool({
      name: 'list_users',
      description: 'List',
      endpoint: 'GET /users',
      responseType: 'summary',
      includeSummary: true,
    })).toThrow(/summary-requires-table/)
  })

  it('throws when params is not a ZodObject', () => {
    expect(() => defineTool({
      name: 'bad',
      description: 'bad',
      endpoint: 'GET /x',
      // @ts-expect-error — runtime guard test
      params: { id: 'string' },
    })).toThrow(/zod ZodObject/)
  })

  it('throws on path-param endpoint with no params schema at all (path-key-mismatch)', () => {
    expect(() => defineTool({
      name: 'get_user',
      description: 'get',
      endpoint: 'GET /users/:id',
    })).toThrow(/path-key-mismatch.*no params schema was provided/)
  })

  it('accepts summary tool when columns are provided', () => {
    expect(() => defineTool({
      name: 'list_users',
      description: 'List',
      endpoint: 'GET /users',
      responseType: 'summary',
      columns: [{ key: 'id', label: 'ID' }],
    })).not.toThrow()
  })

  it('accepts summary tool when responseMapping.dataPath is provided', () => {
    expect(() => defineTool({
      name: 'list_users',
      description: 'List',
      endpoint: 'GET /users',
      responseType: 'summary',
      responseMapping: { dataPath: 'data.users' },
    })).not.toThrow()
  })
})

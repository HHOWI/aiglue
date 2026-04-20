import { describe, it, expect } from 'vitest'
import { checkPathKeyConsistency, checkConfirmMessageForWrites, checkTableColumns } from '../../src/validate/rules.js'

describe('rule: path-key-mismatch', () => {
  it('flags :id in endpoint when params lacks id', () => {
    const errors = checkPathKeyConsistency({
      name: 'get_user',
      description: 'x',
      endpoint: 'GET /api/users/:id',
      params: {},
    })
    expect(errors).toHaveLength(1)
    expect(errors[0].rule).toBe('path-key-mismatch')
    expect(errors[0].path).toBe('tools[get_user].endpoint')
    expect(errors[0].message).toContain(':id')
  })

  it('passes when params has the key', () => {
    const errors = checkPathKeyConsistency({
      name: 'get_user',
      description: 'x',
      endpoint: 'GET /api/users/:id',
      params: { id: { description: 'User ID' } },
    })
    expect(errors).toEqual([])
  })

  it('passes when endpoint has no path params', () => {
    const errors = checkPathKeyConsistency({
      name: 'list',
      description: 'x',
      endpoint: 'GET /api/users',
    })
    expect(errors).toEqual([])
  })

  it('ignores :key inside query string', () => {
    const errors = checkPathKeyConsistency({
      name: 'search',
      description: 'x',
      endpoint: 'GET /api/search?q=:query',
      params: {},
    })
    expect(errors).toEqual([])
  })
})

describe('rule: confirm-message-required', () => {
  it('flags write tool without confirm_message', () => {
    const errors = checkConfirmMessageForWrites({
      name: 'update',
      description: 'x',
      endpoint: 'POST /x',
      risk_level: 'write',
    })
    expect(errors).toHaveLength(1)
    expect(errors[0].rule).toBe('confirm-message-required')
  })

  it('flags critical tool without confirm_message', () => {
    const errors = checkConfirmMessageForWrites({
      name: 'del',
      description: 'x',
      endpoint: 'DELETE /x',
      risk_level: 'critical',
    })
    expect(errors).toHaveLength(1)
  })

  it('passes when confirm_message present', () => {
    const errors = checkConfirmMessageForWrites({
      name: 'update',
      description: 'x',
      endpoint: 'POST /x',
      risk_level: 'write',
      confirm_message: '진행할까요?',
    })
    expect(errors).toEqual([])
  })

  it('passes for read tools', () => {
    const errors = checkConfirmMessageForWrites({
      name: 'list',
      description: 'x',
      endpoint: 'GET /x',
      risk_level: 'read',
    })
    expect(errors).toEqual([])
  })
})

describe('rule: table-columns-required', () => {
  it('flags table response_type without columns', () => {
    const errors = checkTableColumns({
      name: 'list',
      description: 'x',
      endpoint: 'GET /x',
      response_type: 'table',
    })
    expect(errors).toHaveLength(1)
    expect(errors[0].rule).toBe('table-columns-required')
  })

  it('flags table with empty columns array', () => {
    const errors = checkTableColumns({
      name: 'list',
      description: 'x',
      endpoint: 'GET /x',
      response_type: 'table',
      columns: [],
    })
    expect(errors).toHaveLength(1)
  })

  it('passes for table with columns', () => {
    const errors = checkTableColumns({
      name: 'list',
      description: 'x',
      endpoint: 'GET /x',
      response_type: 'table',
      columns: [{ key: 'id', label: 'ID' }],
    })
    expect(errors).toEqual([])
  })

  it('passes for non-table response_type', () => {
    const errors = checkTableColumns({
      name: 'list',
      description: 'x',
      endpoint: 'GET /x',
      response_type: 'text',
    })
    expect(errors).toEqual([])
  })
})

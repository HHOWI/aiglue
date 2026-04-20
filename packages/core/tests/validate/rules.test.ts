import { describe, it, expect } from 'vitest'
import { checkPathKeyConsistency } from '../../src/validate/rules.js'

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
})

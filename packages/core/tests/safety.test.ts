import { describe, it, expect } from 'vitest'
import { SafetyGate } from '../src/safety.js'
import { ToolRegistry } from '../src/tool-registry.js'
import { defineTool } from '../src/define-tool.js'
import { z } from 'zod'

const sampleTools = [
  defineTool({
    name: 'get_users',
    description: '사용자 목록을 조회한다',
    endpoint: 'GET /api/users',
    responseType: 'table',
    riskLevel: 'read',
    columns: [{ key: 'id', label: 'ID' }],
  }),
  defineTool({
    name: 'update_user',
    description: '사용자 정보를 수정한다',
    endpoint: 'PUT /api/users/:id',
    params: z.object({ id: z.string() }),
    riskLevel: 'write',
    confirmMessage: '사용자 정보를 수정합니다. 진행할까요?',
  }),
  defineTool({
    name: 'delete_user',
    description: '사용자를 삭제한다',
    endpoint: 'DELETE /api/users/:id',
    params: z.object({ id: z.string() }),
    riskLevel: 'critical',
    confirmMessage: '사용자를 삭제합니다. 이 작업은 되돌릴 수 없습니다.',
  }),
]

describe('SafetyGate', () => {
  it('should allow read tools without confirmation', () => {
    const registry = ToolRegistry.fromTools(sampleTools)
    const gate = new SafetyGate(registry)
    const result = gate.check('get_users', {})
    expect(result.allowed).toBe(true)
    expect(result.requiresConfirm).toBe(false)
  })

  it('should require confirmation for write tools', () => {
    const registry = ToolRegistry.fromTools(sampleTools)
    const gate = new SafetyGate(registry)
    const result = gate.check('update_user', { id: '1' })
    expect(result.allowed).toBe(true)
    expect(result.requiresConfirm).toBe(true)
  })

  it('should require confirmation for critical tools', () => {
    const registry = ToolRegistry.fromTools(sampleTools)
    const gate = new SafetyGate(registry)
    const result = gate.check('delete_user', { id: '1' })
    expect(result.allowed).toBe(true)
    expect(result.requiresConfirm).toBe(true)
  })

  it('should reject unknown tools (whitelist)', () => {
    const registry = ToolRegistry.fromTools(sampleTools)
    const gate = new SafetyGate(registry)
    const result = gate.check('drop_database', {})
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('not found')
  })
})

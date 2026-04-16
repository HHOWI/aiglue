import { describe, it, expect } from 'vitest'
import { SafetyGate } from '../src/safety.js'
import { ToolRegistry } from '../src/tool-registry.js'
import { resolve } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const fixturePath = resolve(__dirname, 'fixtures/sample-tools.yaml')

describe('SafetyGate', () => {
  it('should allow read tools without confirmation', () => {
    const registry = ToolRegistry.fromFile(fixturePath)
    const gate = new SafetyGate(registry)
    const result = gate.check('get_users', {})
    expect(result.allowed).toBe(true)
    expect(result.requiresConfirm).toBe(false)
  })

  it('should require confirmation for write tools', () => {
    const registry = ToolRegistry.fromFile(fixturePath)
    const gate = new SafetyGate(registry)
    const result = gate.check('update_user', { id: '1' })
    expect(result.allowed).toBe(true)
    expect(result.requiresConfirm).toBe(true)
    expect(result.confirmMessage).toBe('사용자 정보를 수정합니다. 진행할까요?')
  })

  it('should require confirmation for critical tools', () => {
    const registry = ToolRegistry.fromFile(fixturePath)
    const gate = new SafetyGate(registry)
    const result = gate.check('delete_user', { id: '1' })
    expect(result.allowed).toBe(true)
    expect(result.requiresConfirm).toBe(true)
  })

  it('should reject unknown tools (whitelist)', () => {
    const registry = ToolRegistry.fromFile(fixturePath)
    const gate = new SafetyGate(registry)
    const result = gate.check('drop_database', {})
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('not found')
  })
})

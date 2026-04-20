import { describe, it, expect } from 'vitest'
import { resolve } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { lintFile } from '../../src/validate/lint.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const fx = (name: string) => resolve(__dirname, '../fixtures', name)

describe('lintFile — schema only', () => {
  it('returns ok for a valid file', async () => {
    const result = await lintFile(fx('lint-valid.yaml'))
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('reports schema violations with rule=schema and a path', async () => {
    const result = await lintFile(fx('lint-schema-violation.yaml'))
    expect(result.ok).toBe(false)
    const schemaErrors = result.errors.filter(e => e.rule === 'schema')
    expect(schemaErrors.length).toBeGreaterThan(0)
    expect(schemaErrors[0].path).toMatch(/tools\[0\]/)
  })

  it('reports file-not-found as a single error', async () => {
    const result = await lintFile('/nonexistent/path.yaml')
    expect(result.ok).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].rule).toBe('io')
  })

  it('reports malformed YAML as a single error with rule=yaml', async () => {
    const result = await lintFile(fx('lint-malformed.yaml'))
    expect(result.ok).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].rule).toBe('yaml')
  })

  it('detects path-key mismatch through lintFile', async () => {
    const result = await lintFile(fx('lint-missing-path-key.yaml'))
    expect(result.ok).toBe(false)
    expect(result.errors.some(e => e.rule === 'path-key-mismatch')).toBe(true)
  })
})

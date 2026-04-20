import { describe, it, expect } from 'vitest'
import { resolve } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { runLint } from '../../src/cli/lint.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const fx = (name: string) => resolve(__dirname, '../fixtures', name)

describe('aiglue lint (human output)', () => {
  it('returns exit code 0 and prints "OK" for valid file', async () => {
    const out: string[] = []
    const err: string[] = []
    const code = await runLint([fx('lint-valid.yaml')], {
      stdout: (s) => out.push(s),
      stderr: (s) => err.push(s),
    })
    expect(code).toBe(0)
    expect(out.join('')).toContain('OK')
    expect(err).toEqual([])
  })

  it('returns exit code 1 and lists errors for invalid file', async () => {
    const out: string[] = []
    const err: string[] = []
    const code = await runLint([fx('lint-duplicate-name.yaml')], {
      stdout: (s) => out.push(s),
      stderr: (s) => err.push(s),
    })
    expect(code).toBe(1)
    expect(err.join('')).toContain('duplicate-name')
  })

  it('supports --json output', async () => {
    const out: string[] = []
    const err: string[] = []
    const code = await runLint(['--json', fx('lint-duplicate-name.yaml')], {
      stdout: (s) => out.push(s),
      stderr: (s) => err.push(s),
    })
    expect(code).toBe(1)
    const parsed = JSON.parse(out.join(''))
    expect(parsed.ok).toBe(false)
    expect(Array.isArray(parsed.errors)).toBe(true)
  })

  it('returns exit code 2 when no path given', async () => {
    const out: string[] = []
    const err: string[] = []
    const code = await runLint([], {
      stdout: (s) => out.push(s),
      stderr: (s) => err.push(s),
    })
    expect(code).toBe(2)
    expect(err.join('')).toContain('usage')
  })
})

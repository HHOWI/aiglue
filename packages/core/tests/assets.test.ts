import { describe, it, expect } from 'vitest'
import { readFile } from 'fs/promises'
import { resolve } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { lintFile } from '../src/validate/lint.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const asset = (name: string) => resolve(__dirname, '../assets', name)

describe('shipped assets', () => {
  it('claude-skill.md exists and mentions tools.yaml', async () => {
    const text = await readFile(asset('claude-skill.md'), 'utf-8')
    expect(text.length).toBeGreaterThan(100)
    expect(text).toContain('tools.yaml')
  })

  it('cursor-rule.md exists and mentions tools.yaml', async () => {
    const text = await readFile(asset('cursor-rule.md'), 'utf-8')
    expect(text.length).toBeGreaterThan(100)
    expect(text).toContain('tools.yaml')
  })

  it('tools.skeleton.yaml passes lint', async () => {
    const result = await lintFile(asset('tools.skeleton.yaml'))
    expect(result.errors).toEqual([])
    expect(result.ok).toBe(true)
  })
})

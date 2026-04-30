import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, stat } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { runInit } from '../../src/cli/init.js'

let work: string

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), 'aiglue-init-'))
})

afterEach(async () => {
  await rm(work, { recursive: true, force: true })
})

function mkIO() {
  const out: string[] = []
  const err: string[] = []
  return {
    out,
    err,
    io: {
      stdout: (s: string) => out.push(s),
      stderr: (s: string) => err.push(s),
    },
  }
}

describe('aiglue init', () => {
  it('creates tools.ts, .claude/skills/aiglue.md, .cursor/rules/aiglue.md', async () => {
    const { io } = mkIO()
    const code = await runInit(['--cwd', work], io)
    expect(code).toBe(0)
    await expect(stat(join(work, 'tools.ts'))).resolves.toBeDefined()
    await expect(stat(join(work, '.claude/skills/aiglue.md'))).resolves.toBeDefined()
    await expect(stat(join(work, '.cursor/rules/aiglue.md'))).resolves.toBeDefined()
  })

  it('skeleton tools.ts has defineTool', async () => {
    const { io } = mkIO()
    await runInit(['--cwd', work], io)
    const text = await readFile(join(work, 'tools.ts'), 'utf-8')
    expect(text).toContain('defineTool')
  })

  it('does not overwrite existing tools.ts by default', async () => {
    const { io, err } = mkIO()
    const existing = '// existing content\n'
    const { writeFile } = await import('fs/promises')
    await writeFile(join(work, 'tools.ts'), existing, 'utf-8')
    const code = await runInit(['--cwd', work], io)
    expect(code).toBe(0)
    const after = await readFile(join(work, 'tools.ts'), 'utf-8')
    expect(after).toBe(existing)
    expect(err.join('')).toContain('skipped')
  })

  it('--force overwrites existing files', async () => {
    const { io } = mkIO()
    const { writeFile } = await import('fs/promises')
    await writeFile(join(work, 'tools.ts'), 'old\n', 'utf-8')
    await runInit(['--cwd', work, '--force'], io)
    const after = await readFile(join(work, 'tools.ts'), 'utf-8')
    expect(after).toContain('defineTool')
  })

  it('--swagger generates tools.yaml from an OpenAPI spec file', async () => {
    const { io, out } = mkIO()
    const { writeFile } = await import('fs/promises')
    const specPath = join(work, 'openapi.json')
    await writeFile(
      specPath,
      JSON.stringify({
        openapi: '3.0.0',
        info: { title: 'Demo', version: '1.0.0' },
        paths: {
          '/users': {
            get: {
              operationId: 'listUsers',
              summary: 'List users',
              responses: {
                '200': {
                  description: 'OK',
                  content: {
                    'application/json': {
                      schema: { type: 'array', items: { type: 'object' } },
                    },
                  },
                },
              },
            },
          },
          '/users/{id}': {
            delete: {
              operationId: 'deleteUser',
              parameters: [
                { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
              ],
            },
          },
        },
      }),
      'utf-8',
    )

    const code = await runInit(['--cwd', work, '--swagger', specPath], io)
    expect(code).toBe(0)

    const tools = await readFile(join(work, 'tools.yaml'), 'utf-8')
    expect(tools).toContain('listusers')
    expect(tools).toContain('GET /users')
    expect(tools).toContain('deleteuser')
    expect(tools).toContain('DELETE /users/:id')
    expect(tools).toContain('risk_level: critical')
    expect(out.join('')).toContain('generated 2 tools')
  })

  it('--swagger reports the source error when the file is missing', async () => {
    const { io, err } = mkIO()
    const code = await runInit(['--cwd', work, '--swagger', join(work, 'nope.json')], io)
    expect(code).toBe(1)
    expect(err.join('')).toContain('init failed')
  })
})

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, writeFile, stat } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { runGenerateMCP } from '../../src/cli/generate-mcp.js'

let work: string

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), 'aiglue-genmcp-'))
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

describe('aiglue generate-mcp', () => {
  it('emits tools.yaml, claude_desktop_config.snippet.json, and README.md into --output', async () => {
    const toolsPath = join(work, 'tools.yaml')
    await writeFile(toolsPath, 'tools_yaml_version: "1.0"\ntools: []\n', 'utf-8')

    const out = join(work, 'bundle')
    const { io, out: stdout } = mkIO()
    const code = await runGenerateMCP(
      ['--tools', toolsPath, '--base-url', 'https://api.example.com', '--output', out, '--name', 'demo'],
      io,
    )
    expect(code).toBe(0)
    await expect(stat(join(out, 'tools.yaml'))).resolves.toBeDefined()

    const snippet = JSON.parse(await readFile(join(out, 'claude_desktop_config.snippet.json'), 'utf-8'))
    expect(snippet.mcpServers.demo.command).toBe('npx')
    expect(snippet.mcpServers.demo.args).toContain('serve')
    expect(snippet.mcpServers.demo.args).toContain('https://api.example.com')
    expect(snippet.mcpServers.demo.env.AIGLUE_AUTH_TOKEN).toBe('<paste-token-here>')

    const readme = await readFile(join(out, 'README.md'), 'utf-8')
    expect(readme).toContain('demo')
    expect(readme).toContain('https://api.example.com')

    expect(stdout.join('')).toContain('bundle ready')
  })

  it('returns exit code 2 with a helpful error when required flags are missing', async () => {
    const { io, err } = mkIO()
    const code = await runGenerateMCP(['--tools', 'whatever'], io)
    expect(code).toBe(2)
    expect(err.join('')).toMatch(/missing --base-url/)
  })

  it('refuses to overwrite existing files without --force', async () => {
    const toolsPath = join(work, 'tools.yaml')
    await writeFile(toolsPath, 'tools_yaml_version: "1.0"\ntools: []\n', 'utf-8')
    const out = join(work, 'bundle')

    const first = mkIO()
    await runGenerateMCP(
      ['--tools', toolsPath, '--base-url', 'https://api.example.com', '--output', out],
      first.io,
    )

    const second = mkIO()
    const code = await runGenerateMCP(
      ['--tools', toolsPath, '--base-url', 'https://api.example.com', '--output', out],
      second.io,
    )
    expect(code).toBe(0)
    expect(second.err.join('')).toContain('skipped')

    const force = mkIO()
    await runGenerateMCP(
      ['--tools', toolsPath, '--base-url', 'https://api.example.com', '--output', out, '--force'],
      force.io,
    )
    expect(force.out.join('')).toContain('wrote')
  })

  it('errors clearly when the tools file does not exist', async () => {
    const { io, err } = mkIO()
    const code = await runGenerateMCP(
      ['--tools', join(work, 'missing.yaml'), '--base-url', 'https://x', '--output', join(work, 'b')],
      io,
    )
    expect(code).toBe(1)
    expect(err.join('')).toContain('tools file not found')
  })
})

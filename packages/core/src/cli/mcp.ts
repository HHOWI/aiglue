import { resolve } from 'path'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createMCPServer } from '../mcp/server.js'
import type { CliIO } from './lint.js'

interface ServeOptions {
  toolsPath: string
  baseUrl: string
  authToken?: string
  name?: string
  version?: string
}

function parseServeArgs(args: string[]): { ok: true; opts: ServeOptions } | { ok: false; error: string } {
  let toolsPath: string | undefined
  let baseUrl: string | undefined
  let name: string | undefined
  let version: string | undefined
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--tools') toolsPath = args[++i]
    else if (a === '--base-url') baseUrl = args[++i]
    else if (a === '--name') name = args[++i]
    else if (a === '--version') version = args[++i]
    else return { ok: false, error: `unknown argument: ${a}` }
  }
  if (!toolsPath) return { ok: false, error: 'missing --tools <path>' }
  if (!baseUrl) return { ok: false, error: 'missing --base-url <url>' }
  return {
    ok: true,
    opts: {
      toolsPath: resolve(toolsPath),
      baseUrl,
      authToken: process.env.AIGLUE_AUTH_TOKEN || undefined,
      name,
      version,
    },
  }
}

export async function runMCP(args: string[], io: CliIO): Promise<number> {
  const [subcommand, ...rest] = args
  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    io.stdout(
      'aiglue mcp <action> [options]\n' +
      '\n' +
      'actions:\n' +
      '  serve    Run an MCP server over stdio\n' +
      '\n' +
      'serve options:\n' +
      '  --tools <path>      Path to tools.yaml (required)\n' +
      '  --base-url <url>    Upstream API base URL (required)\n' +
      '  --name <name>       Server identity advertised over MCP (default: aiglue)\n' +
      '  --version <v>       Server version advertised over MCP (default: 0.1.0)\n' +
      '\n' +
      'environment:\n' +
      '  AIGLUE_AUTH_TOKEN   Bearer token forwarded as Authorization on every upstream call\n',
    )
    return 0
  }

  if (subcommand !== 'serve') {
    io.stderr(`unknown mcp action: ${subcommand}\n`)
    return 2
  }

  const parsed = parseServeArgs(rest)
  if (!parsed.ok) {
    io.stderr(`${parsed.error}\n`)
    return 2
  }

  try {
    const server = createMCPServer(parsed.opts)
    const transport = new StdioServerTransport()
    await server.connect(transport)
    // Block forever — MCP server keeps running until the host closes the transport.
    await new Promise<void>((resolveLoop) => {
      transport.onclose = () => resolveLoop()
    })
    return 0
  } catch (err) {
    io.stderr(`mcp serve failed: ${err instanceof Error ? err.message : String(err)}\n`)
    return 1
  }
}

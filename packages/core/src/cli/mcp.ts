import { resolve } from 'path'
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'http'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createMCPServer } from '../mcp/server.js'
import type { CliIO } from './types.js'

interface ServeOptions {
  toolsPath: string
  baseUrl: string
  authToken?: string
  name?: string
  version?: string
  transport: 'stdio' | 'http'
  port: number
  host: string
}

function parseServeArgs(args: string[]): { ok: true; opts: ServeOptions } | { ok: false; error: string } {
  let toolsPath: string | undefined
  let baseUrl: string | undefined
  let name: string | undefined
  let version: string | undefined
  let transport: 'stdio' | 'http' = 'stdio'
  let port = 3333
  let host = '127.0.0.1'
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--tools') toolsPath = args[++i]
    else if (a === '--base-url') baseUrl = args[++i]
    else if (a === '--name') name = args[++i]
    else if (a === '--version') version = args[++i]
    else if (a === '--transport') {
      const v = args[++i]
      if (v !== 'stdio' && v !== 'http') return { ok: false, error: `--transport must be 'stdio' or 'http' (got '${v}')` }
      transport = v
    } else if (a === '--port') {
      const v = Number.parseInt(args[++i], 10)
      if (!Number.isFinite(v) || v <= 0 || v >= 65536) return { ok: false, error: `--port must be a valid port number` }
      port = v
    } else if (a === '--host') host = args[++i]
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
      transport,
      port,
      host,
    },
  }
}

/** Pulls a Bearer token from the request's Authorization header, falling back to the env var when
 *  the client did not supply one. Lets one HTTP server handle both single-tenant (env token) and
 *  multi-tenant (per-request token) deployments without a flag. */
function tokenForRequest(req: IncomingMessage, fallback: string | undefined): string | undefined {
  const raw = req.headers['authorization']
  const header = Array.isArray(raw) ? raw[0] : raw
  if (header && header.startsWith('Bearer ')) return header.slice(7)
  return fallback
}

async function serveStdio(opts: ServeOptions): Promise<number> {
  const server = createMCPServer(opts)
  const transport = new StdioServerTransport()
  await server.connect(transport)
  await new Promise<void>((resolveLoop) => {
    transport.onclose = () => resolveLoop()
  })
  return 0
}

async function serveHttp(opts: ServeOptions, io: CliIO): Promise<number> {
  // Stateless mode: each request gets its own server + transport so the per-request bearer token
  // can flow into Executor.execute() as authToken. Tools.yaml is parsed per request, which is cheap
  // for small catalogs and avoids cross-tenant state leakage.
  const httpServer = createHttpServer(async (req: IncomingMessage, res: ServerResponse) => {
    const reqToken = tokenForRequest(req, opts.authToken)
    const server = createMCPServer({ ...opts, authToken: reqToken })
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    try {
      await server.connect(transport)
      await transport.handleRequest(req, res)
    } catch (err) {
      io.stderr(`http handler error: ${err instanceof Error ? err.message : String(err)}\n`)
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' })
        res.end('internal error')
      }
    } finally {
      try { await transport.close() } catch { /* ignore */ }
      try { await server.close() } catch { /* ignore */ }
    }
  })

  await new Promise<void>((listening) => {
    httpServer.listen(opts.port, opts.host, () => listening())
  })
  io.stdout(`mcp http server listening on http://${opts.host}:${opts.port}\n`)

  await new Promise<void>((resolveLoop) => {
    httpServer.on('close', () => resolveLoop())
    process.on('SIGTERM', () => httpServer.close())
    process.on('SIGINT', () => httpServer.close())
  })
  return 0
}

export async function runMCP(args: string[], io: CliIO): Promise<number> {
  const [subcommand, ...rest] = args
  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    io.stdout(
      'aiglue mcp <action> [options]\n' +
      '\n' +
      'actions:\n' +
      '  serve    Run an MCP server\n' +
      '\n' +
      'serve options:\n' +
      '  --tools <path>          Path to tools.yaml (required)\n' +
      '  --base-url <url>        Upstream API base URL (required)\n' +
      '  --transport <kind>      stdio (default) or http (StreamableHTTP)\n' +
      '  --port <n>              HTTP port (default 3333, ignored for stdio)\n' +
      '  --host <h>              HTTP host (default 127.0.0.1, ignored for stdio)\n' +
      '  --name <name>           Server identity advertised over MCP (default: aiglue)\n' +
      '  --version <v>           Server version advertised over MCP (default: 0.1.0)\n' +
      '\n' +
      'environment:\n' +
      '  AIGLUE_AUTH_TOKEN       Fallback bearer token; HTTP mode prefers the request Authorization\n' +
      '                          header so multiple clients can authenticate independently.\n',
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
    if (parsed.opts.transport === 'http') return await serveHttp(parsed.opts, io)
    return await serveStdio(parsed.opts)
  } catch (err) {
    io.stderr(`mcp serve failed: ${err instanceof Error ? err.message : String(err)}\n`)
    return 1
  }
}

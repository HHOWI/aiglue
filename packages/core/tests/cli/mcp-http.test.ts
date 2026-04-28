import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { createServer as createHttpServer, type Server as HttpServer } from 'http'
import { resolve } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { runMCP } from '../../src/cli/mcp.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const fixturePath = resolve(__dirname, '../fixtures/sample-tools.yaml')

let upstream: HttpServer
let upstreamPort: number
let lastAuthHeader: string | undefined

beforeAll(async () => {
  upstream = createHttpServer((req, res) => {
    lastAuthHeader = req.headers.authorization
    if (req.url?.startsWith('/api/users') && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify([{ id: '1', name: 'Alice', role: 'admin' }]))
    } else {
      res.writeHead(404)
      res.end()
    }
  })
  await new Promise<void>((r) => upstream.listen(0, () => {
    const a = upstream.address()
    upstreamPort = typeof a === 'object' && a ? a.port : 0
    r()
  }))
})

afterAll(() => upstream.close())

function pickPort(): Promise<number> {
  // Ask the OS for a free port by listening with port 0, then close.
  return new Promise((resolveFn) => {
    const probe = createHttpServer()
    probe.listen(0, '127.0.0.1', () => {
      const a = probe.address()
      const p = typeof a === 'object' && a ? a.port : 0
      probe.close(() => resolveFn(p))
    })
  })
}

function startMcpHttp(port: number, authToken?: string) {
  const env = { ...process.env }
  if (authToken) process.env.AIGLUE_AUTH_TOKEN = authToken
  else delete process.env.AIGLUE_AUTH_TOKEN

  const out: string[] = []
  const err: string[] = []
  const io = { stdout: (s: string) => out.push(s), stderr: (s: string) => err.push(s) }

  // runMCP blocks until SIGTERM/SIGINT triggers httpServer.close — fire it as a side promise.
  const promise = runMCP(
    [
      'serve',
      '--tools', fixturePath,
      '--base-url', `http://localhost:${upstreamPort}`,
      '--transport', 'http',
      '--port', String(port),
      '--host', '127.0.0.1',
    ],
    io,
  )

  return {
    promise,
    out,
    err,
    cleanup: async () => {
      // Restore env
      process.env = env
      // Trigger SIGINT to make the server close. Many test runners do not propagate this nicely;
      // we instead call process.emit which the SIGINT/SIGTERM listener catches.
      process.emit('SIGINT', 'SIGINT')
      // Wait briefly for cleanup
      await new Promise((r) => setTimeout(r, 50))
    },
  }
}

describe('aiglue mcp serve --transport http', () => {
  it('serves listTools / callTool over StreamableHTTP and forwards the bearer token', async () => {
    const port = await pickPort()
    const handle = startMcpHttp(port)

    // Wait until the server prints the listening line — runMCP writes it to stdout.
    await new Promise<void>((r) => {
      const start = Date.now()
      const tick = setInterval(() => {
        if (handle.out.some((s) => s.includes('listening on'))) {
          clearInterval(tick)
          r()
        } else if (Date.now() - start > 3000) {
          clearInterval(tick)
          r()
        }
      }, 20)
    })

    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${port}/`),
      {
        requestInit: {
          headers: { Authorization: 'Bearer client-jwt-xyz' },
        },
      },
    )
    const client = new Client({ name: 'test', version: '1.0.0' }, { capabilities: {} })
    await client.connect(transport)

    const tools = await client.listTools()
    expect(tools.tools.map((t) => t.name).sort()).toEqual(['delete_user', 'get_users', 'update_user'])

    const result = await client.callTool({ name: 'get_users', arguments: {} })
    expect(result.isError).toBeFalsy()
    expect(lastAuthHeader).toBe('Bearer client-jwt-xyz')

    await client.close()
    await handle.cleanup()
    await handle.promise.catch(() => undefined)
  }, 10_000)
})

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createServer, type Server as HttpServer } from 'http'
import { resolve } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { createMCPServer } from '../../src/mcp/server.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const fixturePath = resolve(__dirname, '../fixtures/sample-tools.yaml')

let upstream: HttpServer
let upstreamPort: number
let lastAuthHeader: string | undefined

beforeAll(async () => {
  upstream = createServer((req, res) => {
    lastAuthHeader = req.headers.authorization
    if (req.url?.startsWith('/api/users') && !req.url.startsWith('/api/users/') && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify([{ id: '1', name: 'Alice', role: 'admin' }]))
    } else if (req.url?.startsWith('/api/users/') && req.method === 'PUT') {
      let body = ''
      req.on('data', (c) => { body += c })
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ updated: true, body: JSON.parse(body) }))
      })
    } else {
      res.writeHead(404)
      res.end()
    }
  })
  await new Promise<void>((r) => upstream.listen(0, () => {
    const addr = upstream.address()
    upstreamPort = typeof addr === 'object' && addr ? addr.port : 0
    r()
  }))
})

afterAll(() => upstream.close())

async function connectClient(authToken?: string) {
  const server = createMCPServer({
    toolsPath: fixturePath,
    baseUrl: `http://localhost:${upstreamPort}`,
    authToken,
  })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()

  const client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} })
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  return { client, server }
}

describe('createMCPServer — listTools', () => {
  it('returns every tool from tools.yaml with proper input schema', async () => {
    const { client, server } = await connectClient()

    const list = await client.listTools()
    const names = list.tools.map((t) => t.name).sort()
    expect(names).toEqual(['delete_user', 'get_users', 'update_user'])

    const getUsers = list.tools.find((t) => t.name === 'get_users')!
    expect(getUsers.description).not.toContain('[WRITE')
    expect(getUsers.description).not.toContain('[CRITICAL')
    expect(getUsers.description).toContain('Example queries:')

    const inputSchema = getUsers.inputSchema as { type: string; properties: Record<string, unknown> }
    expect(inputSchema.type).toBe('object')
    expect(inputSchema.properties.role).toBeDefined()

    await client.close()
    await server.close()
  })

  it('prefixes write tools with [WRITE OPERATION] and critical with [CRITICAL OPERATION ...]', async () => {
    const { client, server } = await connectClient()
    const list = await client.listTools()

    const update = list.tools.find((t) => t.name === 'update_user')!
    expect(update.description.startsWith('[WRITE OPERATION]')).toBe(true)

    const del = list.tools.find((t) => t.name === 'delete_user')!
    expect(del.description.startsWith('[CRITICAL OPERATION')).toBe(true)

    await client.close()
    await server.close()
  })
})

describe('createMCPServer — callTool', () => {
  it('invokes the upstream API and returns serialized JSON', async () => {
    const { client, server } = await connectClient()

    const result = await client.callTool({ name: 'get_users', arguments: {} })
    expect(result.isError).toBeFalsy()
    const content = result.content as Array<{ type: string; text: string }>
    expect(content[0].type).toBe('text')
    const parsed = JSON.parse(content[0].text)
    expect(parsed).toEqual([{ id: '1', name: 'Alice', role: 'admin' }])

    await client.close()
    await server.close()
  })

  it('forwards the AIGLUE_AUTH_TOKEN as Authorization: Bearer ...', async () => {
    const { client, server } = await connectClient('test-token-123')

    await client.callTool({ name: 'update_user', arguments: { id: '1', name: 'X' } })
    expect(lastAuthHeader).toBe('Bearer test-token-123')

    await client.close()
    await server.close()
  })

  it('returns an isError CallToolResult when the upstream returns a non-2xx', async () => {
    const { client, server } = await connectClient()

    // delete_user has DELETE method but the upstream mock only handles PUT — returns 404
    const result = await client.callTool({ name: 'delete_user', arguments: { id: '1' } })
    expect(result.isError).toBe(true)
    const content = result.content as Array<{ type: string; text: string }>
    expect(content[0].text).toMatch(/Upstream returned status \d+/)

    await client.close()
    await server.close()
  })

  it('returns an isError CallToolResult for unknown tools instead of crashing the server', async () => {
    const { client, server } = await connectClient()

    const result = await client.callTool({ name: 'not_a_tool', arguments: {} })
    expect(result.isError).toBe(true)
    const content = result.content as Array<{ type: string; text: string }>
    expect(content[0].text).toContain('not_a_tool')

    await client.close()
    await server.close()
  })
})

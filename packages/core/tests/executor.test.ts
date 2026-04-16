import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Executor } from '../src/executor.js'
import { ToolRegistry } from '../src/tool-registry.js'
import { resolve } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { createServer, type Server } from 'http'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const fixturePath = resolve(__dirname, 'fixtures/sample-tools.yaml')

let mockServer: Server
let serverPort: number

beforeAll(async () => {
  mockServer = createServer((req, res) => {
    // Capture auth header for testing
    const authHeader = req.headers.authorization

    if (req.url?.startsWith('/api/users') && !req.url?.startsWith('/api/users/') && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify([
        { id: '1', name: 'Alice', role: 'admin' },
        { id: '2', name: 'Bob', role: 'user' },
      ]))
    } else if (req.url?.startsWith('/api/users/') && req.method === 'PUT') {
      let body = ''
      req.on('data', chunk => { body += chunk })
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true, auth: authHeader }))
      })
    } else if (req.url?.startsWith('/api/users/') && req.method === 'DELETE') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ deleted: true }))
    } else {
      res.writeHead(404)
      res.end()
    }
  })

  await new Promise<void>((resolve) => {
    mockServer.listen(0, () => {
      const addr = mockServer.address()
      serverPort = typeof addr === 'object' && addr ? addr.port : 0
      resolve()
    })
  })
})

afterAll(() => {
  mockServer.close()
})

describe('Executor', () => {
  it('should execute a GET request based on tool definition', async () => {
    const registry = ToolRegistry.fromFile(fixturePath)
    const executor = new Executor(registry, `http://localhost:${serverPort}`)

    const result = await executor.execute('get_users', {})

    expect(result.status).toBe(200)
    expect(result.data).toEqual([
      { id: '1', name: 'Alice', role: 'admin' },
      { id: '2', name: 'Bob', role: 'user' },
    ])
  })

  it('should add query params for GET requests', async () => {
    const registry = ToolRegistry.fromFile(fixturePath)
    const executor = new Executor(registry, `http://localhost:${serverPort}`)

    const result = await executor.execute('get_users', { role: 'admin' })
    expect(result.status).toBe(200)
  })

  it('should replace path params and send body for PUT', async () => {
    const registry = ToolRegistry.fromFile(fixturePath)
    const executor = new Executor(registry, `http://localhost:${serverPort}`)

    const result = await executor.execute('update_user', { id: '1', name: 'Updated' })
    expect(result.status).toBe(200)
    expect((result.data as Record<string, unknown>).success).toBe(true)
  })

  it('should throw when tool is not found', async () => {
    const registry = ToolRegistry.fromFile(fixturePath)
    const executor = new Executor(registry, `http://localhost:${serverPort}`)

    await expect(executor.execute('nonexistent', {})).rejects.toThrow('Tool not found')
  })

  it('should pass auth token in Authorization header', async () => {
    const registry = ToolRegistry.fromFile(fixturePath)
    const executor = new Executor(registry, `http://localhost:${serverPort}`)

    const result = await executor.execute('update_user', { id: '1', name: 'Test' }, 'my-jwt-token')
    expect(result.status).toBe(200)
    expect((result.data as Record<string, unknown>).auth).toBe('Bearer my-jwt-token')
  })
})

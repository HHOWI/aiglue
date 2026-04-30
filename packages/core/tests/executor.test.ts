import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Executor } from '../src/executor.js'
import { ToolRegistry } from '../src/tool-registry.js'
import { defineTool } from '../src/define-tool.js'
import { z } from 'zod'
import { createServer, type Server } from 'http'

const sampleTools = [
  defineTool({
    name: 'get_users',
    description: '사용자 목록을 조회한다',
    endpoint: 'GET /api/users',
    responseType: 'table',
    riskLevel: 'read',
    columns: [{ key: 'id', label: 'ID' }],
  }),
  defineTool({
    name: 'update_user',
    description: '사용자 정보를 수정한다',
    endpoint: 'PUT /api/users/:id',
    params: z.object({ id: z.string(), name: z.string().optional() }),
    riskLevel: 'write',
    confirmMessage: '사용자 정보를 수정합니다. 진행할까요?',
  }),
  defineTool({
    name: 'delete_user',
    description: '사용자를 삭제한다',
    endpoint: 'DELETE /api/users/:id',
    params: z.object({ id: z.string() }),
    riskLevel: 'critical',
    confirmMessage: '사용자를 삭제합니다. 이 작업은 되돌릴 수 없습니다.',
  }),
]

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
    const registry = ToolRegistry.fromTools(sampleTools)
    const executor = new Executor(registry, `http://localhost:${serverPort}`)

    const result = await executor.execute('get_users', {})

    expect(result.status).toBe(200)
    expect(result.data).toEqual([
      { id: '1', name: 'Alice', role: 'admin' },
      { id: '2', name: 'Bob', role: 'user' },
    ])
  })

  it('should add query params for GET requests', async () => {
    const registry = ToolRegistry.fromTools(sampleTools)
    const executor = new Executor(registry, `http://localhost:${serverPort}`)

    const result = await executor.execute('get_users', { role: 'admin' })
    expect(result.status).toBe(200)
  })

  it('should replace path params and send body for PUT', async () => {
    const registry = ToolRegistry.fromTools(sampleTools)
    const executor = new Executor(registry, `http://localhost:${serverPort}`)

    const result = await executor.execute('update_user', { id: '1', name: 'Updated' })
    expect(result.status).toBe(200)
    expect((result.data as Record<string, unknown>).success).toBe(true)
  })

  it('should throw when tool is not found', async () => {
    const registry = ToolRegistry.fromTools(sampleTools)
    const executor = new Executor(registry, `http://localhost:${serverPort}`)

    await expect(executor.execute('nonexistent', {})).rejects.toThrow('Tool not found')
  })

  it('should pass auth token in Authorization header', async () => {
    const registry = ToolRegistry.fromTools(sampleTools)
    const executor = new Executor(registry, `http://localhost:${serverPort}`)

    const result = await executor.execute('update_user', { id: '1', name: 'Test' }, 'my-jwt-token')
    expect(result.status).toBe(200)
    expect((result.data as Record<string, unknown>).auth).toBe('Bearer my-jwt-token')
  })

  it('should include boolean false in query params', async () => {
    const registry = ToolRegistry.fromTools([
      defineTool({
        name: 'search',
        description: 'Search',
        endpoint: 'GET /api/search',
        riskLevel: 'read',
      }),
    ])
    let capturedUrl = ''
    const captureServer = createServer((req, res) => {
      capturedUrl = req.url ?? ''
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({}))
    })
    const capturePort = await new Promise<number>((resolve) => {
      captureServer.listen(0, () => {
        const addr = captureServer.address()
        resolve(typeof addr === 'object' && addr ? addr.port : 0)
      })
    })

    const execCapture = new Executor(registry, `http://localhost:${capturePort}`)
    await execCapture.execute('search', { active: false })
    captureServer.close()

    expect(capturedUrl).toContain('active=false')
  })

  it('should include 0 in query params', async () => {
    const registry = ToolRegistry.fromTools([
      defineTool({
        name: 'page',
        description: 'Page',
        endpoint: 'GET /api/items',
        riskLevel: 'read',
      }),
    ])
    let capturedUrl = ''
    const captureServer = createServer((req, res) => {
      capturedUrl = req.url ?? ''
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({}))
    })
    const capturePort = await new Promise<number>((r) => {
      captureServer.listen(0, () => {
        const addr = captureServer.address()
        r(typeof addr === 'object' && addr ? addr.port : 0)
      })
    })
    const execCapture = new Executor(registry, `http://localhost:${capturePort}`)
    await execCapture.execute('page', { offset: 0 })
    captureServer.close()

    expect(capturedUrl).toContain('offset=0')
  })

  it('should throw when required path param is null', async () => {
    const registry = ToolRegistry.fromTools([
      defineTool({
        name: 'get_item',
        description: 'Get item',
        endpoint: 'GET /api/items/:id',
        params: z.object({ id: z.string() }),
        riskLevel: 'read',
      }),
    ])
    const executor = new Executor(registry, `http://localhost:${serverPort}`)

    // zod catches null before the path-param check fires
    await expect(
      executor.execute('get_item', { id: null as unknown as string })
    ).rejects.toThrow('params validation failed')
  })

  it('should throw when required path param is undefined', async () => {
    const registry = ToolRegistry.fromTools([
      defineTool({
        name: 'get_item',
        description: 'Get item',
        endpoint: 'GET /api/items/:id',
        params: z.object({ id: z.string() }),
        riskLevel: 'read',
      }),
    ])
    const executor = new Executor(registry, `http://localhost:${serverPort}`)

    // zod catches missing required field before the path-param check fires
    await expect(
      executor.execute('get_item', {})
    ).rejects.toThrow('params validation failed')
  })

  it('should reject responses with Content-Length over maxResponseBytes', async () => {
    const registry = ToolRegistry.fromTools([
      defineTool({
        name: 'big',
        description: 'big',
        endpoint: 'GET /api/big',
        riskLevel: 'read',
      }),
    ])
    const huge = 'x'.repeat(2000)
    const bigServer = createServer((_req, res) => {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Length': String(Buffer.byteLength(huge, 'utf-8')),
      })
      res.end(huge)
    })
    const bigPort = await new Promise<number>((r) => {
      bigServer.listen(0, () => {
        const addr = bigServer.address()
        r(typeof addr === 'object' && addr ? addr.port : 0)
      })
    })

    const exec = new Executor(registry, `http://localhost:${bigPort}`, 10_000, 1000)
    await expect(exec.execute('big', {})).rejects.toThrow('exceeds maxResponseBytes')
    await new Promise<void>((r) => bigServer.close(() => r()))
  })

  it('should reject chunked responses that exceed maxResponseBytes during streaming', async () => {
    const registry = ToolRegistry.fromTools([
      defineTool({
        name: 'chunked',
        description: 'chunked',
        endpoint: 'GET /api/chunked',
        riskLevel: 'read',
      }),
    ])
    const chunkedServer = createServer((_req, res) => {
      // Omit Content-Length → chunked transfer
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.write('x'.repeat(500))
      res.write('x'.repeat(500))
      res.write('x'.repeat(500))
      res.end()
    })
    const chunkedPort = await new Promise<number>((r) => {
      chunkedServer.listen(0, () => {
        const addr = chunkedServer.address()
        r(typeof addr === 'object' && addr ? addr.port : 0)
      })
    })

    const exec = new Executor(registry, `http://localhost:${chunkedPort}`, 10_000, 1000)
    await expect(exec.execute('chunked', {})).rejects.toThrow('exceeds maxResponseBytes')
    await new Promise<void>((r) => chunkedServer.close(() => r()))
  })

  it('throws validation error when LLM-supplied params fail schema', async () => {
    const registry = ToolRegistry.fromTools([
      defineTool({
        name: 'get_user',
        description: 'get',
        endpoint: 'GET /users/:id',
        params: z.object({ id: z.string() }),
        riskLevel: 'read',
      }),
    ])
    const exec = new Executor(registry, `http://localhost:${serverPort}`)

    await expect(
      exec.execute('get_user', { id: 42 } as unknown as Record<string, unknown>),
    ).rejects.toThrow(/params validation failed/)
  })

  it('should URL-encode path params to prevent path injection', async () => {
    const registry = ToolRegistry.fromTools([
      defineTool({
        name: 'get_item',
        description: 'Get item',
        endpoint: 'GET /api/items/:id',
        params: z.object({ id: z.string() }),
        riskLevel: 'read',
      }),
    ])
    let capturedUrl = ''
    const captureServer = createServer((req, res) => {
      capturedUrl = req.url ?? ''
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    })
    const capturePort = await new Promise<number>((r) => {
      captureServer.listen(0, () => {
        const addr = captureServer.address()
        r(typeof addr === 'object' && addr ? addr.port : 0)
      })
    })
    const execCapture = new Executor(registry, `http://localhost:${capturePort}`)

    // Path traversal attempt: ".." should be encoded
    await execCapture.execute('get_item', { id: '../admin/users' })
    expect(capturedUrl).toBe('/api/items/..%2Fadmin%2Fusers')

    // Slash should be encoded (not break out of path segment)
    await execCapture.execute('get_item', { id: 'a/b' })
    expect(capturedUrl).toBe('/api/items/a%2Fb')

    // Query/fragment chars should be encoded
    await execCapture.execute('get_item', { id: 'x?y=1#z' })
    expect(capturedUrl).toBe('/api/items/x%3Fy%3D1%23z')

    captureServer.close()
  })
})

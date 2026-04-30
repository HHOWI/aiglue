import { ToolRegistry } from './tool-registry.js'

export interface ExecutionResult {
  status: number
  data: unknown
  headers: Record<string, string>
}

const DEFAULT_MAX_RESPONSE_BYTES = 5 * 1024 * 1024 // 5 MB

export class Executor {
  private registry: ToolRegistry
  private baseUrl: string
  private timeoutMs: number
  private maxResponseBytes: number

  constructor(
    registry: ToolRegistry,
    baseUrl: string,
    timeoutMs = 10000,
    maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
  ) {
    this.registry = registry
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.timeoutMs = timeoutMs
    this.maxResponseBytes = maxResponseBytes
  }

  async execute(
    toolName: string,
    params: Record<string, unknown>,
    authToken?: string,
  ): Promise<ExecutionResult> {
    const tool = this.registry.getTool(toolName)
    if (!tool) {
      throw new Error(`Tool not found: ${toolName}`)
    }

    const { method, path } = this.registry.parseEndpoint(tool.endpoint)

    // Validate all path params are provided (non-null)
    const pathParamNames = [...path.matchAll(/:(\w+)/g)].map(m => m[1])
    const missingParams = pathParamNames.filter(p => params[p] == null)
    if (missingParams.length > 0) {
      throw new Error(`Missing required path param(s): ${missingParams.join(', ')}`)
    }

    // Replace path params with URL-encoded values to prevent path injection (e.g., "../admin", "a/b")
    let resolvedPath = path
    for (const paramName of pathParamNames) {
      const value = params[paramName]
      resolvedPath = resolvedPath.replace(`:${paramName}`, encodeURIComponent(String(value)))
    }

    // Build URL with query params for GET
    const url = new URL(resolvedPath, this.baseUrl)
    if (method === 'GET') {
      for (const [key, value] of Object.entries(params)) {
        if (!path.includes(`:${key}`) && value != null) {
          url.searchParams.set(key, String(value))
        }
      }
    }

    // Build request body for POST/PUT/PATCH
    let body: string | undefined
    if (['POST', 'PUT', 'PATCH'].includes(method)) {
      const bodyData: Record<string, unknown> = { ...(tool.requestBodyTemplate ?? {}) }
      for (const [key, value] of Object.entries(params)) {
        if (!path.includes(`:${key}`)) {
          bodyData[key] = value
        }
      }
      body = JSON.stringify(bodyData)
    }

    // Build headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)

    try {
      const response = await fetch(url.toString(), {
        method,
        headers,
        body,
        signal: controller.signal,
      })

      const responseData = await this.readWithCap(response)

      return {
        status: response.status,
        data: responseData,
        headers: Object.fromEntries(response.headers.entries()),
      }
    } finally {
      clearTimeout(timeout)
    }
  }

  private async readWithCap(response: Response): Promise<unknown> {
    // Fast path: trust Content-Length when present.
    const cl = response.headers.get('content-length')
    if (cl) {
      const len = Number.parseInt(cl, 10)
      if (Number.isFinite(len) && len > this.maxResponseBytes) {
        throw new Error(
          `Response body exceeds maxResponseBytes (${len} > ${this.maxResponseBytes})`,
        )
      }
    }

    if (!response.body) return null

    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > this.maxResponseBytes) {
        await reader.cancel()
        throw new Error(
          `Response body exceeds maxResponseBytes (${total} > ${this.maxResponseBytes})`,
        )
      }
      chunks.push(value)
    }

    if (chunks.length === 0) return null
    const text = Buffer.concat(chunks).toString('utf-8')
    if (!text) return null
    try {
      return JSON.parse(text)
    } catch {
      return null
    }
  }
}

import { ToolRegistry } from './tool-registry.js'

export interface ExecutionResult {
  status: number
  data: unknown
  headers: Record<string, string>
}

export class Executor {
  private registry: ToolRegistry
  private baseUrl: string
  private timeoutMs: number

  constructor(registry: ToolRegistry, baseUrl: string, timeoutMs = 10000) {
    this.registry = registry
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.timeoutMs = timeoutMs
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

    // Replace path params (e.g., :id)
    let resolvedPath = path
    for (const [key, value] of Object.entries(params)) {
      resolvedPath = resolvedPath.replace(`:${key}`, String(value))
    }

    // Build URL with query params for GET
    const url = new URL(resolvedPath, this.baseUrl)
    if (method === 'GET') {
      for (const [key, value] of Object.entries(params)) {
        if (!path.includes(`:${key}`) && value !== undefined && value !== null) {
          url.searchParams.set(key, String(value))
        }
      }
    }

    // Build request body for POST/PUT/PATCH
    let body: string | undefined
    if (['POST', 'PUT', 'PATCH'].includes(method)) {
      const bodyData: Record<string, unknown> = { ...(tool.request_body_template ?? {}) }
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

      const responseData = await response.json().catch(() => null)

      return {
        status: response.status,
        data: responseData,
        headers: Object.fromEntries(response.headers.entries()),
      }
    } finally {
      clearTimeout(timeout)
    }
  }
}

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type ListToolsResult,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js'
import { zodToJsonSchema } from 'zod-to-json-schema'
import type { ZodSchema } from 'zod/v3'
import type { ZodObject, ZodRawShape } from 'zod'
import { ToolRegistry } from '../tool-registry.js'
import { Executor } from '../executor.js'
import type { ToolDefinition } from '../types.js'

/** Calls zodToJsonSchema with the zod/v3 ZodSchema type to prevent TS2589. See tool-registry.ts. */
function paramsToJsonSchema(params: ZodObject<ZodRawShape>): Record<string, unknown> {
  return zodToJsonSchema(params as unknown as ZodSchema, { target: 'openApi3', $refStrategy: 'none' }) as Record<string, unknown>
}

export interface MCPServerConfig {
  /** Pre-loaded tool definitions. Use this instead of toolsPath when you have already loaded
   *  the module (e.g. via loadToolsModule). One of tools or toolsPath is required. */
  tools?: ToolDefinition[]
  /**
   * @deprecated Pass pre-loaded `tools` instead. toolsPath is kept for back-compat but
   * requires ToolRegistry.fromFile which was removed — callers must load via loadToolsModule.
   * This field is unused internally; the CLI loads tools before calling createMCPServer.
   */
  toolsPath?: string
  /** Base URL the executor uses to reach the upstream API. */
  baseUrl: string
  /** Bearer token forwarded as Authorization header on every upstream call. Optional. */
  authToken?: string
  /** Override server identity advertised over the MCP handshake. */
  name?: string
  version?: string
  /** Per-request HTTP timeout in ms. Default 10000. */
  timeoutMs?: number
  /** Hard cap on upstream response body size in bytes. Default 5_242_880 (5 MB). */
  maxResponseBytes?: number
}

/** Risk-level prefix added to the LLM-visible description. Lets the host (Claude Desktop, etc.) decide
 *  whether to surface its own confirm UI before invoking a write/critical tool. */
function riskPrefix(tool: ToolDefinition): string {
  const level = tool.riskLevel ?? 'read'
  if (level === 'read') return ''
  if (level === 'write') return '[WRITE OPERATION] '
  return '[CRITICAL OPERATION — IRREVERSIBLE] '
}

function toMCPTool(tool: ToolDefinition): Tool {
  const baseDescription = tool.description
  const examplesSuffix =
    tool.examples && tool.examples.length > 0
      ? `\n\nExample queries: ${tool.examples.join(', ')}`
      : ''
  const description = `${riskPrefix(tool)}${baseDescription}${examplesSuffix}`

  const inputSchema: Record<string, unknown> = tool.params
    ? paramsToJsonSchema(tool.params)
    : { type: 'object', properties: {} }

  return {
    name: tool.name,
    description,
    inputSchema: inputSchema as Tool['inputSchema'],
  }
}

/** Build an MCP server backed by a pre-loaded tools array. The caller wires up the transport
 *  (stdio, StreamableHTTP, …). Use `loadToolsModule` from `@hhowi/aiglue-core/cli/load-tools`
 *  to load a JS/TS module and pass its `tools` export here. */
export function createMCPServer(config: MCPServerConfig): Server {
  const definitions = config.tools ?? []
  const registry = ToolRegistry.fromTools(definitions)
  const executor = new Executor(
    registry,
    config.baseUrl,
    config.timeoutMs,
    config.maxResponseBytes,
  )

  const server = new Server(
    {
      name: config.name ?? 'aiglue',
      version: config.version ?? '0.1.0',
    },
    { capabilities: { tools: {} } },
  )

  server.setRequestHandler(ListToolsRequestSchema, async (): Promise<ListToolsResult> => {
    return { tools: registry.getAllTools().map(toMCPTool) }
  })

  server.setRequestHandler(CallToolRequestSchema, async (req): Promise<CallToolResult> => {
    const { name, arguments: args } = req.params
    const params = (args ?? {}) as Record<string, unknown>

    if (!registry.hasTool(name)) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Tool "${name}" is not defined in tools.yaml.` }],
      }
    }

    try {
      const result = await executor.execute(name, params, config.authToken)
      if (result.status >= 400) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Upstream returned status ${result.status}.`,
            },
          ],
        }
      }
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result.data, null, 2),
          },
        ],
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return {
        isError: true,
        content: [{ type: 'text', text: `Tool execution failed: ${msg}` }],
      }
    }
  })

  return server
}

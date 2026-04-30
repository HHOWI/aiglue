import { zodToJsonSchema } from 'zod-to-json-schema'
// Import ZodSchema from zod/v3 (the exact type zodToJsonSchema expects) to avoid TS2589
// "type instantiation excessively deep" when passing ZodObject<ZodRawShape> from zod main.
import type { ZodSchema } from 'zod/v3'
import type { ZodObject, ZodRawShape } from 'zod'
import type { ToolDefinition, LLMToolDefinition } from './types.js'

/** Calls zodToJsonSchema, routing through zod/v3's ZodSchema to prevent TS2589 deep instantiation
 *  that occurs when TypeScript checks ZodObject<ZodRawShape> (main zod) against ZodSchema (zod/v3). */
function paramsToJsonSchema(params: ZodObject<ZodRawShape>): Record<string, unknown> {
  return zodToJsonSchema(params as unknown as ZodSchema, { target: 'openApi3', $refStrategy: 'none' }) as Record<string, unknown>
}

export interface ToolIndexEntry {
  name: string
  /** Description condensed to ~80 chars for cheap stage-1 routing. */
  shortDescription: string
  /** Up to 2 example queries — kept on the index because LLM precision improves a lot with examples. */
  examples: string[]
}

export class ToolRegistry {
  private tools: Map<string, ToolDefinition>
  private llmToolsCache: LLMToolDefinition[] | null = null
  private indexCache: ToolIndexEntry[] | null = null

  private constructor(definitions: ToolDefinition[]) {
    this.tools = new Map()
    this.applyDefinitions(definitions)
  }

  static fromTools(definitions: ToolDefinition[]): ToolRegistry {
    return new ToolRegistry(definitions)
  }

  private applyDefinitions(definitions: ToolDefinition[]): void {
    const next = new Map<string, ToolDefinition>()
    for (const tool of definitions) {
      if (next.has(tool.name)) {
        throw new Error(`Duplicate tool name "${tool.name}". Tool names must be unique.`)
      }
      next.set(tool.name, tool)
    }
    this.tools = next
    this.llmToolsCache = null
    this.indexCache = null
  }

  getTool(name: string): ToolDefinition | undefined { return this.tools.get(name) }
  hasTool(name: string): boolean { return this.tools.has(name) }
  getToolNames(): string[] { return Array.from(this.tools.keys()) }
  getAllTools(): ToolDefinition[] { return Array.from(this.tools.values()) }

  parseEndpoint(endpoint: string): { method: string; path: string } {
    const spaceIndex = endpoint.indexOf(' ')
    if (spaceIndex === -1) throw new Error(`Invalid endpoint format: "${endpoint}". Expected "METHOD /path"`)
    return { method: endpoint.slice(0, spaceIndex).toUpperCase(), path: endpoint.slice(spaceIndex + 1) }
  }

  toLLMTools(): LLMToolDefinition[] {
    return (this.llmToolsCache ??= this.buildLLMTools())
  }

  /** Lightweight per-tool summary for stage-1 routing in two-stage mode. ~30–50 tokens per entry. */
  toIndex(): ToolIndexEntry[] {
    return (this.indexCache ??= this.buildIndex())
  }

  /** Subset of the registry restricted to the given tool names. Caller already validated the names exist. */
  toLLMToolsSubset(names: string[]): LLMToolDefinition[] {
    const wanted = new Set(names)
    return this.toLLMTools().filter(t => wanted.has(t.name))
  }

  private buildIndex(): ToolIndexEntry[] {
    return this.getAllTools().map(tool => {
      const fallback = tool.description.split(/\.\s|\n/)[0]
      const trimmed = fallback.length > 80 ? fallback.slice(0, 80).trimEnd() + '…' : fallback
      const shortDescription = tool.shortDescription ?? trimmed
      const examples = (tool.examples ?? []).slice(0, 2)
      return { name: tool.name, shortDescription, examples }
    })
  }

  private buildLLMTools(): LLMToolDefinition[] {
    return this.getAllTools().map(tool => {
      let description = tool.description
      if (tool.examples && tool.examples.length > 0) {
        description += `\n\nExample queries: ${tool.examples.join(', ')}`
      }
      // zodToJsonSchema's conditional return type causes TS2589 when called with a generic
      // ZodObject<TParams>. We use a typed helper that erases the ZodObject generic before
      // calling so the return-type instantiation is bounded.
      const parameters: Record<string, unknown> = tool.params
        ? paramsToJsonSchema(tool.params)
        : { type: 'object', properties: {} }
      return { name: tool.name, description, parameters }
    })
  }
}

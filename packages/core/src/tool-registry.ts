import { zodToJsonSchema } from 'zod-to-json-schema'
import type { ToolDefinition, LLMToolDefinition } from './types.js'

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
      const parameters: Record<string, unknown> = tool.params
        ? (zodToJsonSchema(tool.params, { target: 'openApi3', $refStrategy: 'none' }) as { type: 'object'; properties: Record<string, unknown> })
        : { type: 'object', properties: {} }
      return { name: tool.name, description, parameters }
    })
  }
}

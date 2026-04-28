import { readFileSync } from 'fs'
import { parse } from 'yaml'
import type { ToolsConfig, ToolDefinition, LLMToolDefinition } from './types.js'

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

  private constructor(config: ToolsConfig) {
    this.tools = new Map()
    this.applyConfig(config)
  }

  static fromFile(filePath: string): ToolRegistry {
    const reg = new ToolRegistry({ tools_yaml_version: '1.0', tools: [] })
    reg.loadFromFile(filePath)
    return reg
  }

  static fromConfig(config: ToolsConfig): ToolRegistry {
    return new ToolRegistry(config)
  }

  /** Atomic swap of the internal tool map. Throws on parse / validation errors without mutating state. */
  loadFromFile(filePath: string): void {
    const content = readFileSync(filePath, 'utf-8')
    const config = parse(content) as ToolsConfig
    if (!config.tools || !Array.isArray(config.tools)) {
      throw new Error('Invalid tools.yaml: missing "tools" array')
    }
    this.applyConfig(config)
  }

  private applyConfig(config: ToolsConfig): void {
    // Build the new map in full first, then swap — failures (e.g., duplicate names) leave existing state intact.
    const next = new Map<string, ToolDefinition>()
    for (const tool of config.tools) {
      if (next.has(tool.name)) {
        throw new Error(`Duplicate tool name "${tool.name}" in tools.yaml. Tool names must be unique.`)
      }
      next.set(tool.name, tool)
    }
    this.tools = next
    this.llmToolsCache = null
    this.indexCache = null
  }

  getTool(name: string): ToolDefinition | undefined {
    return this.tools.get(name)
  }

  hasTool(name: string): boolean {
    return this.tools.has(name)
  }

  getToolNames(): string[] {
    return Array.from(this.tools.keys())
  }

  getAllTools(): ToolDefinition[] {
    return Array.from(this.tools.values())
  }

  parseEndpoint(endpoint: string): { method: string; path: string } {
    const spaceIndex = endpoint.indexOf(' ')
    if (spaceIndex === -1) {
      throw new Error(`Invalid endpoint format: "${endpoint}". Expected "METHOD /path"`)
    }
    return {
      method: endpoint.slice(0, spaceIndex).toUpperCase(),
      path: endpoint.slice(spaceIndex + 1),
    }
  }

  toLLMTools(): LLMToolDefinition[] {
    // Computed once — registry is immutable after construction
    return (this.llmToolsCache ??= this.buildLLMTools())
  }

  /** Lightweight per-tool summary for stage-1 routing in two-stage mode. ~30–50 tokens per entry. */
  toIndex(): ToolIndexEntry[] {
    return (this.indexCache ??= this.buildIndex())
  }

  /** Subset of the registry restricted to the given tool names. Caller already validated the names exist. */
  toLLMToolsSubset(names: string[]): LLMToolDefinition[] {
    const wanted = new Set(names)
    return this.toLLMTools().filter((t) => wanted.has(t.name))
  }

  private buildIndex(): ToolIndexEntry[] {
    return this.getAllTools().map((tool) => {
      const firstSentence = tool.description.split(/\.\s|\n/)[0]
      const shortDescription = firstSentence.length > 80
        ? firstSentence.slice(0, 80).trimEnd() + '…'
        : firstSentence
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

      const properties: Record<string, Record<string, unknown>> = {}
      const required: string[] = []

      if (tool.params) {
        for (const [paramName, paramDef] of Object.entries(tool.params)) {
          properties[paramName] = {
            type: paramDef.type ?? 'string',
            description: paramDef.description,
          }
          if (paramDef.enum) {
            properties[paramName].enum = paramDef.enum
          }
          if (paramDef.required) {
            required.push(paramName)
          }
        }
      }

      return {
        name: tool.name,
        description,
        parameters: {
          type: 'object',
          properties,
          required: required.length > 0 ? required : undefined,
        },
      }
    })
  }
}

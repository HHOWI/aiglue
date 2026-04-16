import { readFileSync } from 'fs'
import { parse } from 'yaml'
import type { ToolsConfig, ToolDefinition, LLMToolDefinition } from './types.js'

export class ToolRegistry {
  private tools: Map<string, ToolDefinition>

  private constructor(config: ToolsConfig) {
    this.tools = new Map()
    for (const tool of config.tools) {
      this.tools.set(tool.name, tool)
    }
  }

  static fromFile(filePath: string): ToolRegistry {
    const content = readFileSync(filePath, 'utf-8')
    const config = parse(content) as ToolsConfig
    if (!config.tools || !Array.isArray(config.tools)) {
      throw new Error('Invalid tools.yaml: missing "tools" array')
    }
    return new ToolRegistry(config)
  }

  static fromConfig(config: ToolsConfig): ToolRegistry {
    return new ToolRegistry(config)
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

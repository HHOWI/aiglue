import type { LLMProvider } from '../providers/types.js'
import type { ChatMessage, LLMToolDefinition, RoutingConfig } from '../types.js'
import type { ToolIndexEntry, ToolRegistry } from '../tool-registry.js'

const SELECT_TOOLS_META: LLMToolDefinition = {
  name: 'select_tools',
  description:
    'Select the tools that could fulfill the user request. Respond with the names of relevant tools (1 or more).',
  parameters: {
    type: 'object',
    properties: {
      names: {
        type: 'array',
        items: { type: 'string' },
        description: 'Tool names from the catalog above that match the user request.',
      },
    },
    required: ['names'],
  },
}

const ROUTER_SYSTEM_PROMPT = `You are a router. Given the user's request and the tool catalog below, pick the tools that could fulfill it.
Use the select_tools tool to return the candidate names. If unsure, include more candidates rather than fewer — the next stage validates them with the full schemas.`

function renderCatalog(index: ToolIndexEntry[]): string {
  return index
    .map((entry) => {
      const ex = entry.examples.length > 0 ? ` Examples: ${entry.examples.join(', ')}` : ''
      return `- ${entry.name}: ${entry.shortDescription}${ex}`
    })
    .join('\n')
}

export interface RouteResult {
  /** Subset of tool definitions to forward to the main resolver. */
  tools: LLMToolDefinition[]
  /** Stage-1 token spend (only set when two-stage actually fires; 0 otherwise). */
  tokensIn: number
  tokensOut: number
  /** True if two-stage was attempted and we fell back to the full catalog. Useful for logging. */
  fellBack: boolean
}

export class Router {
  private provider: LLMProvider
  private registry: ToolRegistry
  private strategy: 'single' | 'two-stage'

  constructor(provider: LLMProvider, registry: ToolRegistry, config?: RoutingConfig) {
    this.provider = provider
    this.registry = registry
    this.strategy = config?.strategy ?? 'single'
  }

  /** Returns the tool subset that the main IntentResolver should see, plus the stage-1 cost. */
  async decide(userInput: string, history: ChatMessage[]): Promise<RouteResult> {
    if (this.strategy === 'single') {
      return { tools: this.registry.toLLMTools(), tokensIn: 0, tokensOut: 0, fellBack: false }
    }

    const index = this.registry.toIndex()
    if (index.length === 0) {
      return { tools: this.registry.toLLMTools(), tokensIn: 0, tokensOut: 0, fellBack: false }
    }

    const catalog = renderCatalog(index)
    const messages: ChatMessage[] = [
      { role: 'system', content: `${ROUTER_SYSTEM_PROMPT}\n\nAvailable tools:\n${catalog}` },
      ...history,
      { role: 'user', content: userInput },
    ]

    try {
      const response = await this.provider.resolve(messages, [SELECT_TOOLS_META])
      const tokensIn = response.tokensIn
      const tokensOut = response.tokensOut

      const namesRaw = (response.toolCall?.params as { names?: unknown } | undefined)?.names
      if (!Array.isArray(namesRaw)) {
        return { tools: this.registry.toLLMTools(), tokensIn, tokensOut, fellBack: true }
      }

      const validNames = namesRaw
        .filter((n): n is string => typeof n === 'string')
        .filter((n) => this.registry.hasTool(n))

      if (validNames.length === 0) {
        return { tools: this.registry.toLLMTools(), tokensIn, tokensOut, fellBack: true }
      }

      return {
        tools: this.registry.toLLMToolsSubset(validNames),
        tokensIn,
        tokensOut,
        fellBack: false,
      }
    } catch {
      // Stage-1 LLM failure (timeout / rate-limit / 5xx) → degrade to single-stage rather than fail the request.
      return { tools: this.registry.toLLMTools(), tokensIn: 0, tokensOut: 0, fellBack: true }
    }
  }
}

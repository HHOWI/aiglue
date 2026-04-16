import type { LLMProvider } from './providers/types.js'
import type { LLMResponse, ChatMessage } from './types.js'
import { ToolRegistry } from './tool-registry.js'

const SYSTEM_PROMPT = `You are an AI assistant that helps users interact with an existing system through natural language.

Your role:
1. Understand the user's intent from their natural language input
2. Select the most appropriate tool from the available tools
3. Extract the required parameters from the user's message

Rules:
- ONLY use tools from the provided tool list. Never invent tools.
- If the user's request is unclear, ask for clarification instead of guessing.
- Extract parameters accurately from the user's message.
- If a required parameter is missing, ask the user for it.
- Respond in the same language as the user's input.`

export class IntentResolver {
  private provider: LLMProvider
  private registry: ToolRegistry
  private domainContext: string | null

  constructor(provider: LLMProvider, registry: ToolRegistry, domainContext?: string) {
    this.provider = provider
    this.registry = registry
    this.domainContext = domainContext ?? null
  }

  async resolve(userInput: string, conversationHistory?: ChatMessage[]): Promise<LLMResponse> {
    const messages: ChatMessage[] = []

    let systemContent = SYSTEM_PROMPT
    if (this.domainContext) {
      systemContent += `\n\nDomain knowledge:\n${this.domainContext}`
    }
    messages.push({ role: 'system', content: systemContent })

    if (conversationHistory) {
      messages.push(...conversationHistory)
    }

    messages.push({ role: 'user', content: userInput })

    const tools = this.registry.toLLMTools()

    return this.provider.resolve(messages, tools)
  }
}

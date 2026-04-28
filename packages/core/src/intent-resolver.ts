import type { LLMProvider } from './providers/types.js'
import type { LLMResponse, ChatMessage, LLMToolDefinition } from './types.js'
import { ToolRegistry } from './tool-registry.js'

/** Reserved tool name the resolver injects so the LLM has a structured way to ask the user for
 *  clarification instead of guessing. The engine intercepts calls to this name and produces an
 *  AIEClarifyResponse — it never reaches SafetyGate or Executor. The double-underscore prefix is
 *  reserved (lint blocks it on user tools.yaml). */
export const CLARIFY_META_TOOL = '__aiglue_clarify__'

const CLARIFY_TOOL_DEF: LLMToolDefinition = {
  name: CLARIFY_META_TOOL,
  description:
    'Ask the user a clarifying question when the request is too ambiguous to pick a real tool — for example "show me that" with no recent context, or a parameter that could mean multiple things. Prefer this over guessing or returning prose. Provide 2–4 short option strings when the choice is small and discrete; omit options when free-form input is needed.',
  parameters: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description: 'Short clarifying question shown to the user, in the same language as their input.',
      },
      options: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional small set of answer choices the host can render as buttons.',
      },
    },
    required: ['question'],
  },
}

const SYSTEM_PROMPT = `You are an AI assistant that helps users interact with an existing system through natural language.

Your role:
1. Understand the user's intent from their natural language input
2. Select the most appropriate tool from the available tools
3. Extract the required parameters from the user's message

Rules:
- ONLY use tools from the provided tool list. Never invent tools.
- If the user's request is unclear, call ${CLARIFY_META_TOOL}({ question, options? }) to ask a structured follow-up question instead of guessing.
- Extract parameters accurately from the user's message.
- If a required parameter is missing, ask via ${CLARIFY_META_TOOL} for it.
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

  async resolve(
    userInput: string,
    conversationHistory?: ChatMessage[],
    /** Optional pre-filtered subset (e.g. supplied by the Router). Defaults to the full registry. */
    toolsOverride?: LLMToolDefinition[],
  ): Promise<LLMResponse> {
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

    const baseTools = toolsOverride ?? this.registry.toLLMTools()
    // Always make the clarify meta tool available — the engine intercepts it before safety/executor.
    const tools = [...baseTools, CLARIFY_TOOL_DEF]

    return this.provider.resolve(messages, tools)
  }
}

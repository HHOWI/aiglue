import OpenAI from 'openai'
import type { LLMProvider, ChatOptions, ChatResponse } from './types.js'
import type { ChatMessage, LLMToolDefinition, LLMResponse } from '../types.js'

export interface OpenAIProviderConfig {
  apiKey?: string
  model: string
  baseUrl?: string
  timeoutMs?: number
}

export class OpenAIProvider implements LLMProvider {
  private client: OpenAI
  private model: string

  constructor(config: OpenAIProviderConfig) {
    if (!config.model) {
      throw new Error(
        "openai-compatible provider requires 'model' in LLMConfig",
      )
    }
    this.model = config.model
    this.client = new OpenAI({
      apiKey: config.apiKey ?? 'no-key-required',
      baseURL: config.baseUrl,
      timeout: config.timeoutMs ?? 30_000,
    })
  }

  async resolve(
    messages: ChatMessage[],
    tools: LLMToolDefinition[],
  ): Promise<LLMResponse> {
    const openaiMessages = messages.map(
      (m): OpenAI.Chat.Completions.ChatCompletionMessageParam => {
        switch (m.role) {
          case 'system':
            return { role: 'system', content: m.content }
          case 'user':
            return { role: 'user', content: m.content }
          case 'assistant':
            return { role: 'assistant', content: m.content }
        }
      },
    )

    const openaiTools = tools.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }))

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: openaiMessages,
      tools: openaiTools.length > 0 ? openaiTools : undefined,
    })

    const message = response.choices[0]?.message
    let toolCall: LLMResponse['toolCall'] = null
    let textContent: string | null = null

    const toolCalls = message?.tool_calls
    if (toolCalls && toolCalls.length > 0 && toolCalls[0].type === 'function') {
      const call = toolCalls[0]
      let params: Record<string, unknown> = {}
      try {
        params = JSON.parse(call.function.arguments) as Record<string, unknown>
      } catch {
        throw new Error(
          `Failed to parse tool_calls arguments as JSON: ${call.function.arguments}`,
        )
      }
      toolCall = {
        toolName: call.function.name,
        params,
      }
    } else if (message?.content) {
      textContent = message.content
    }

    return {
      toolCall,
      textContent,
      tokensIn: response.usage?.prompt_tokens ?? 0,
      tokensOut: response.usage?.completion_tokens ?? 0,
    }
  }

  async chat(
    messages: ChatMessage[],
    opts?: ChatOptions,
  ): Promise<ChatResponse> {
    const baseMessages = messages.map(
      (m): OpenAI.Chat.Completions.ChatCompletionMessageParam => {
        switch (m.role) {
          case 'system':
            return { role: 'system', content: m.content }
          case 'user':
            return { role: 'user', content: m.content }
          case 'assistant':
            return { role: 'assistant', content: m.content }
        }
      },
    )

    const openaiMessages = opts?.system
      ? [
          { role: 'system' as const, content: opts.system },
          ...baseMessages.filter((m) => m.role !== 'system'),
        ]
      : baseMessages

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: openaiMessages,
      max_tokens: opts?.maxTokens ?? 1024,
    })

    return {
      text: response.choices[0]?.message?.content ?? '',
      tokensIn: response.usage?.prompt_tokens ?? 0,
      tokensOut: response.usage?.completion_tokens ?? 0,
    }
  }
}

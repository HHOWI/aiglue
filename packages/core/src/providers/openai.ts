import OpenAI from 'openai'
import type { LLMProvider, ChatOptions, ChatResponse } from './types.js'
import type { ChatMessage, LLMToolDefinition, LLMResponse, LLMToolCallResult } from '../types.js'

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
    const toolCalls: LLMToolCallResult[] = []
    let textContent: string | null = null

    if (message?.tool_calls) {
      for (const tc of message.tool_calls) {
        if (tc.type === 'function') {
          let params: Record<string, unknown> = {}
          if (tc.function.arguments) {
            try {
              params = JSON.parse(tc.function.arguments) as Record<string, unknown>
            } catch {
              throw new Error(
                `Failed to parse tool_calls arguments as JSON: ${tc.function.arguments}`,
              )
            }
          }
          toolCalls.push({
            toolName: tc.function.name,
            params,
          })
        }
      }
    }

    if (message?.content) {
      textContent = message.content
    }

    return {
      toolCalls,
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

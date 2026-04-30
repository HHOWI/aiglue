import Anthropic from '@anthropic-ai/sdk'
import type { LLMProvider, ChatOptions, ChatResponse } from './types.js'
import type { ChatMessage, LLMToolDefinition, LLMResponse, LLMToolCallResult } from '../types.js'

export class ClaudeProvider implements LLMProvider {
  private client: Anthropic
  private model: string

  constructor(apiKey: string, model?: string, timeoutMs?: number) {
    this.client = new Anthropic({ apiKey, timeout: timeoutMs ?? 30_000 })
    this.model = model ?? 'claude-sonnet-4-20250514'
  }

  async resolve(
    messages: ChatMessage[],
    tools: LLMToolDefinition[],
  ): Promise<LLMResponse> {
    const systemMessage = messages.find(m => m.role === 'system')
    const chatMessages = messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }))

    // Mark the last tool with cache_control to cache the entire tools+system prefix
    // (Anthropic prompt caching, ephemeral 5-min TTL — gives ~90% discount on cache hits).
    const anthropicTools: Anthropic.Tool[] = tools.map((t, idx) => {
      const base: Anthropic.Tool = {
        name: t.name,
        description: t.description,
        input_schema: t.parameters as Anthropic.Tool['input_schema'],
      }
      if (idx === tools.length - 1) {
        base.cache_control = { type: 'ephemeral' }
      }
      return base
    })

    const systemBlocks: Anthropic.TextBlockParam[] | undefined = systemMessage?.content
      ? [{
          type: 'text',
          text: systemMessage.content,
          cache_control: { type: 'ephemeral' },
        }]
      : undefined

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 1024,
      system: systemBlocks,
      messages: chatMessages,
      tools: anthropicTools,
    })

    const toolCalls: LLMToolCallResult[] = []
    let textContent: string | null = null
    for (const block of response.content) {
      if (block.type === 'tool_use') {
        toolCalls.push({ toolName: block.name, params: block.input as Record<string, unknown> })
      } else if (block.type === 'text') {
        textContent = block.text
      }
    }
    return {
      toolCalls,
      textContent,
      tokensIn: response.usage.input_tokens,
      tokensOut: response.usage.output_tokens,
    }
  }

  async chat(
    messages: ChatMessage[],
    opts?: ChatOptions,
  ): Promise<ChatResponse> {
    const systemFromMessages = messages.find((m) => m.role === 'system')?.content
    const chatMessages = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }))

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: opts?.maxTokens ?? 1024,
      system: opts?.system ?? systemFromMessages,
      messages: chatMessages,
    })

    const textBlock = response.content.find((b) => b.type === 'text')
    return {
      text: textBlock && textBlock.type === 'text' ? textBlock.text : '',
      tokensIn: response.usage.input_tokens,
      tokensOut: response.usage.output_tokens,
    }
  }
}

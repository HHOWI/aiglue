import Anthropic from '@anthropic-ai/sdk'
import type { LLMProvider, ChatOptions, ChatResponse } from './types.js'
import type { ChatMessage, LLMToolDefinition, LLMResponse } from '../types.js'

export class ClaudeProvider implements LLMProvider {
  private client: Anthropic
  private model: string

  constructor(apiKey: string, model?: string) {
    this.client = new Anthropic({ apiKey })
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

    const anthropicTools = tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters as Anthropic.Tool['input_schema'],
    }))

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 1024,
      system: systemMessage?.content,
      messages: chatMessages,
      tools: anthropicTools,
    })

    let toolCall = null
    let textContent = null

    for (const block of response.content) {
      if (block.type === 'tool_use') {
        toolCall = {
          toolName: block.name,
          params: block.input as Record<string, unknown>,
        }
      } else if (block.type === 'text') {
        textContent = block.text
      }
    }

    return {
      toolCall,
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

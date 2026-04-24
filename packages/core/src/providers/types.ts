import type { LLMToolDefinition, LLMResponse, ChatMessage } from '../types.js'

export interface ChatOptions {
  /** Optional system prompt. When set, replaces/supplements any system message in the messages array. */
  system?: string
  /** Completion token cap. Defaults to 1024. */
  maxTokens?: number
}

export interface ChatResponse {
  text: string
  tokensIn: number
  tokensOut: number
}

export interface LLMProvider {
  resolve(
    messages: ChatMessage[],
    tools: LLMToolDefinition[],
  ): Promise<LLMResponse>
  /**
   * Generic text-completion primitive. No tools, no function calling.
   * Used by Summarizer and future auto/clarify components.
   */
  chat(messages: ChatMessage[], opts?: ChatOptions): Promise<ChatResponse>
}

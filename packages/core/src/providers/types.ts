import type { LLMToolDefinition, LLMResponse, ChatMessage } from '../types.js'

export interface LLMProvider {
  resolve(
    messages: ChatMessage[],
    tools: LLMToolDefinition[],
  ): Promise<LLMResponse>
}

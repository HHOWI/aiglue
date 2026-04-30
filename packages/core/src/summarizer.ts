import type { LLMProvider } from './providers/types.js'
import { Logger } from './logger.js'
import type {
  ToolDefinition,
  AIEResponse,
  AIETableResponse,
  AIETextResponse,
  AIESummaryResponse,
  ChatMessage,
} from './types.js'

const SUMMARY_SYSTEM_PROMPT = `You summarize API responses for end users in natural, conversational language.
Constraints:
- Be concise. Max 2-3 sentences for summary-only responses, 1 sentence when asked for a short summary.
- Never invent data not present in the tool result.
- Match the language of the user question.`

const MAX_SUMMARY_TOKENS = 300
const FALLBACK_TEXT_MAX_LENGTH = 2000

export class Summarizer {
  constructor(
    private provider: LLMProvider,
    private logger: Logger,
  ) {}

  async maybeSummarize(
    tool: ToolDefinition,
    userQuery: string,
    apiResponse: unknown,
    base: AIEResponse,
  ): Promise<AIEResponse> {
    const wantSummary = tool.responseType === 'summary'
    const wantInclude =
      tool.responseType === 'table' &&
      tool.includeSummary === true &&
      base.type === 'table'

    if (!wantSummary && !wantInclude) return base

    try {
      const { text } = await this.provider.chat(
        this.buildMessages(tool, userQuery, apiResponse),
        { system: SUMMARY_SYSTEM_PROMPT, maxTokens: MAX_SUMMARY_TOKENS },
      )
      if (wantSummary) {
        const summary: AIESummaryResponse = {
          type: 'summary',
          text,
          source: apiResponse,
        }
        return summary
      }
      const withSummary: AIETableResponse = {
        ...(base as AIETableResponse),
        summary: text,
      }
      return withSummary
    } catch (err) {
      this.logger.warn('summarization failed, falling back', {
        tool: tool.name,
        error: err instanceof Error ? err.message : String(err),
      })
      if (wantSummary) {
        return this.buildTextFallback(apiResponse)
      }
      return base
    }
  }

  private buildMessages(
    tool: ToolDefinition,
    userQuery: string,
    apiResponse: unknown,
  ): ChatMessage[] {
    const serialized = this.safeStringify(apiResponse)
    return [
      { role: 'user', content: userQuery },
      {
        role: 'assistant',
        content: `I called ${tool.name} and got: ${serialized}`,
      },
      { role: 'user', content: 'Summarize that result for me.' },
    ]
  }

  private buildTextFallback(apiResponse: unknown): AIETextResponse {
    const raw = this.safeStringify(apiResponse)
    return {
      type: 'text',
      content: raw.slice(0, FALLBACK_TEXT_MAX_LENGTH),
    }
  }

  private safeStringify(value: unknown): string {
    if (typeof value === 'string') return value
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
}

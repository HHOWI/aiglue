import type {
  ToolDefinition,
  AIEResponse,
  AIETextResponse,
  AIETableResponse,
  AIERawResponse,
  AIEMultiResponse,
} from './types.js'

export class ResponseFormatter {
  format(tool: ToolDefinition, apiResponse: unknown): AIEResponse {
    const responseType = tool.responseType ?? 'text'

    switch (responseType) {
      case 'table':
        return this.formatTable(tool, apiResponse)
      case 'raw':
        return this.formatRaw(apiResponse)
      case 'text':
      default:
        return this.formatText(apiResponse)
    }
  }

  private formatRaw(apiResponse: unknown): AIERawResponse {
    return { type: 'raw', data: apiResponse }
  }

  private formatTable(tool: ToolDefinition, apiResponse: unknown): AIEResponse {
    let rows: Record<string, unknown>[] = []
    let total: number | undefined

    if (tool.responseMapping?.dataPath) {
      const extracted = this.getNestedValue(apiResponse, tool.responseMapping.dataPath)
      if (extracted === undefined || extracted === null) {
        return this.formatError(
          `dataPath "${tool.responseMapping.dataPath}" not found in API response for tool "${tool.name}". Check responseMapping in tool definition.`,
          'DATA_PATH_NOT_FOUND',
        )
      }
      if (!Array.isArray(extracted)) {
        return this.formatError(
          `dataPath "${tool.responseMapping.dataPath}" in tool "${tool.name}" resolved to ${typeof extracted}, expected array.`,
          'DATA_PATH_NOT_ARRAY',
        )
      }
      rows = extracted as Record<string, unknown>[]
    } else if (Array.isArray(apiResponse)) {
      rows = apiResponse as Record<string, unknown>[]
    }

    if (tool.responseMapping?.totalPath) {
      const rawTotal = this.getNestedValue(apiResponse, tool.responseMapping.totalPath)
      if (rawTotal != null) {
        const n = Number(rawTotal)
        total = Number.isFinite(n) ? n : undefined
      }
    }

    return {
      type: 'table',
      columns: tool.columns ?? [],
      rows,
      total,
    }
  }

  private formatText(apiResponse: unknown): AIETextResponse {
    return {
      type: 'text',
      content: typeof apiResponse === 'string'
        ? apiResponse
        : JSON.stringify(apiResponse, null, 2),
    }
  }

  private getNestedValue(obj: unknown, path: string): unknown {
    const keys = path.split('.')
    let current: unknown = obj
    for (const key of keys) {
      if (current === null || current === undefined || typeof current !== 'object') {
        return undefined
      }
      current = (current as Record<string, unknown>)[key]
    }
    return current
  }

  formatAction(success: boolean, message: string): AIEResponse {
    return { type: 'action', status: success ? 'success' : 'failed', message }
  }

  formatConfirm(
    tool: ToolDefinition,
    params: Record<string, unknown>,
    message?: string,
    confirmToken?: string,
  ): AIEResponse {
    return {
      type: 'confirm',
      message: message ?? tool.confirmMessage ?? `Confirm "${tool.name}"?`,
      toolName: tool.name,
      params,
      ...(confirmToken ? { confirmToken } : {}),
    }
  }

  formatError(message: string, code: string): AIEResponse {
    return { type: 'error', message, code }
  }

  formatClarify(question: string, options?: string[]): AIEResponse {
    const cleaned = (options ?? []).filter((o) => typeof o === 'string' && o.length > 0)
    return {
      type: 'clarify',
      question,
      ...(cleaned.length > 0 ? { options: cleaned } : {}),
    }
  }

  formatMulti(results: Exclude<AIEResponse, AIEMultiResponse>[]): AIEMultiResponse {
    return { type: 'multi', results }
  }
}

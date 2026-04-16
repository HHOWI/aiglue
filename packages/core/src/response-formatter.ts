import type { ToolDefinition, AIEResponse, AIETextResponse, AIETableResponse } from './types.js'

export class ResponseFormatter {
  format(tool: ToolDefinition, apiResponse: unknown): AIEResponse {
    const responseType = tool.response_type ?? 'text'

    switch (responseType) {
      case 'table':
        return this.formatTable(tool, apiResponse)
      case 'text':
      default:
        return this.formatText(apiResponse)
    }
  }

  private formatTable(tool: ToolDefinition, apiResponse: unknown): AIETableResponse {
    let rows: Record<string, unknown>[] = []
    let total: number | undefined

    if (tool.response_mapping?.data_path) {
      rows = this.getNestedValue(apiResponse, tool.response_mapping.data_path) ?? []
    } else if (Array.isArray(apiResponse)) {
      rows = apiResponse
    }

    if (!Array.isArray(rows)) {
      rows = []
    }

    if (tool.response_mapping?.total_path) {
      total = this.getNestedValue(apiResponse, tool.response_mapping.total_path) as number | undefined
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

  formatConfirm(tool: ToolDefinition, params: Record<string, unknown>): AIEResponse {
    return {
      type: 'confirm',
      message: tool.confirm_message ?? `${tool.name} 작업을 실행합니다. 진행할까요?`,
      toolName: tool.name,
      params,
    }
  }

  formatError(message: string, code: string): AIEResponse {
    return { type: 'error', message, code }
  }
}

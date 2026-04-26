import type { RequestLog } from './types.js'

export function redactParams(
  params: Record<string, unknown> | null,
  sensitiveKeys: string[],
): Record<string, unknown> | null {
  if (!params || sensitiveKeys.length === 0) return params
  const result = { ...params }
  for (const key of sensitiveKeys) {
    if (key in result) result[key] = '[REDACTED]'
  }
  return result
}

export class Logger {
  log(entry: RequestLog): void {
    console.log(JSON.stringify(entry))
  }

  warn(message: string, detail?: unknown): void {
    console.warn(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'warn',
      message,
      ...(detail !== undefined ? { detail } : {}),
    }))
  }

  error(message: string, error?: unknown): void {
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'error',
      message,
      error: error instanceof Error ? error.message : String(error),
    }))
  }
}

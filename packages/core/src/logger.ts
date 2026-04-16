import type { RequestLog } from './types.js'

export class Logger {
  log(entry: RequestLog): void {
    const logLine = JSON.stringify(entry)
    console.log(logLine)
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

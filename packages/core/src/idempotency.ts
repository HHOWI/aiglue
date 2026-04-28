import type { AIEResponse } from './types.js'

interface Entry {
  response: AIEResponse
  expiresAt: number
}

/** Server-side dedup of confirmAndExecute calls. Keyed by client-supplied idempotencyKey. */
export class IdempotencyStore {
  private store: Map<string, Entry> = new Map()
  private ttlMs: number

  constructor(ttlMs = 5 * 60 * 1000) {
    this.ttlMs = ttlMs
  }

  get(key: string): AIEResponse | null {
    const entry = this.store.get(key)
    if (!entry) return null
    if (Date.now() >= entry.expiresAt) {
      this.store.delete(key)
      return null
    }
    return entry.response
  }

  record(key: string, response: AIEResponse): void {
    this.store.set(key, { response, expiresAt: Date.now() + this.ttlMs })
  }

  /** Visible for tests; not part of the public API. */
  size(): number {
    return this.store.size
  }
}

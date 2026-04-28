interface RateLimitEntry {
  count: number
  resetAt: number
}

interface ParsedLimit {
  max: number
  windowMs: number
}

export class RateLimiter {
  private limits: Map<string, RateLimitEntry> = new Map()
  private globalLimit: ParsedLimit
  private perUserLimit: ParsedLimit | null
  private sweepHandle: ReturnType<typeof setInterval> | null = null

  constructor(config: {
    global?: string
    perUser?: string
    /** Period for the background sweep that drops expired entries. Default 60_000ms. Pass 0 to disable. */
    sweepIntervalMs?: number
  }) {
    this.globalLimit = this.parseRateString(config.global ?? '60/min')
    this.perUserLimit = config.perUser ? this.parseRateString(config.perUser) : null

    const sweepInterval = config.sweepIntervalMs ?? 60_000
    if (sweepInterval > 0) {
      this.sweepHandle = setInterval(() => this.sweep(), sweepInterval)
      // Don't keep the Node event loop alive solely for the sweeper.
      this.sweepHandle.unref?.()
    }
  }

  check(key: string): boolean {
    const now = Date.now()
    const { max, windowMs } = this.resolveLimit(key)

    const entry = this.limits.get(key)

    // Evict stale entry — lazy cleanup prevents unbounded map growth
    if (entry && now >= entry.resetAt) {
      this.limits.delete(key)
    }

    const current = this.limits.get(key)

    if (!current) {
      this.limits.set(key, { count: 1, resetAt: now + windowMs })
      return true
    }

    if (current.count >= max) {
      return false
    }

    current.count++
    return true
  }

  /** Visible for tests; runs lazily otherwise via the sweep interval. */
  sweep(): number {
    const now = Date.now()
    let removed = 0
    for (const [key, entry] of this.limits) {
      if (now >= entry.resetAt) {
        this.limits.delete(key)
        removed++
      }
    }
    return removed
  }

  /** Visible for tests / graceful shutdown. */
  size(): number {
    return this.limits.size
  }

  /** Stops the background sweeper. Call this on shutdown to allow Node to exit. */
  dispose(): void {
    if (this.sweepHandle) {
      clearInterval(this.sweepHandle)
      this.sweepHandle = null
    }
  }

  private resolveLimit(key: string): ParsedLimit {
    if (key === 'global' || !this.perUserLimit) {
      return this.globalLimit
    }
    return this.perUserLimit
  }

  private parseRateString(rate: string): ParsedLimit {
    const match = rate.match(/^(\d+)\/(min|hour|sec)$/)
    if (!match) {
      return { max: 60, windowMs: 60_000 }
    }

    const max = parseInt(match[1], 10)
    const unit = match[2]
    const windowMs = unit === 'sec' ? 1_000 : unit === 'min' ? 60_000 : 3_600_000

    return { max, windowMs }
  }
}

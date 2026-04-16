interface RateLimitEntry {
  count: number
  resetAt: number
}

export class RateLimiter {
  private limits: Map<string, RateLimitEntry> = new Map()
  private maxRequests: number
  private windowMs: number

  constructor(config: { global?: string }) {
    const parsed = this.parseRateString(config.global ?? '60/min')
    this.maxRequests = parsed.max
    this.windowMs = parsed.windowMs
  }

  check(key: string): boolean {
    const now = Date.now()
    const entry = this.limits.get(key)

    if (!entry || now >= entry.resetAt) {
      this.limits.set(key, { count: 1, resetAt: now + this.windowMs })
      return true
    }

    if (entry.count >= this.maxRequests) {
      return false
    }

    entry.count++
    return true
  }

  private parseRateString(rate: string): { max: number; windowMs: number } {
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

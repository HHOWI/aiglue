import { describe, it, expect } from 'vitest'
import { RateLimiter } from '../src/rate-limiter.js'

describe('RateLimiter', () => {
  it('should allow requests within limit', () => {
    const limiter = new RateLimiter({ global: '3/min' })
    expect(limiter.check('global')).toBe(true)
    expect(limiter.check('global')).toBe(true)
    expect(limiter.check('global')).toBe(true)
  })

  it('should block requests exceeding limit', () => {
    const limiter = new RateLimiter({ global: '2/min' })
    expect(limiter.check('global')).toBe(true)
    expect(limiter.check('global')).toBe(true)
    expect(limiter.check('global')).toBe(false)
  })

  it('should track per-key limits independently', () => {
    const limiter = new RateLimiter({ global: '1/min' })
    expect(limiter.check('user-1')).toBe(true)
    expect(limiter.check('user-2')).toBe(true)
    expect(limiter.check('user-1')).toBe(false)
    expect(limiter.check('user-2')).toBe(false)
  })

  it('should parse rate string correctly', () => {
    const limiter = new RateLimiter({ global: '100/min' })
    expect(limiter.check('test')).toBe(true)
  })
})

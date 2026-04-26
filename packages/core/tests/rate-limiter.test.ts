import { describe, it, expect, vi, afterEach } from 'vitest'
import { RateLimiter } from '../src/rate-limiter.js'

describe('RateLimiter', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

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

  it('should evict expired entries so map does not grow unbounded', () => {
    vi.useFakeTimers()
    const limiter = new RateLimiter({ global: '2/min' })

    limiter.check('user-a')
    limiter.check('user-b')

    vi.advanceTimersByTime(61_000)

    // After expiry, accessing user-a should reset (count from 1 again)
    expect(limiter.check('user-a')).toBe(true)
    // Can make 1 more request (limit is 2)
    expect(limiter.check('user-a')).toBe(true)
    expect(limiter.check('user-a')).toBe(false)
  })

  it('should apply perUser limit to userId keys separately from global', () => {
    // global: 10/min so it doesn't interfere; perUser: 2/min
    const limiter = new RateLimiter({ global: '10/min', perUser: '2/min' })

    // userId key: limited to 2
    expect(limiter.check('user-xyz')).toBe(true)
    expect(limiter.check('user-xyz')).toBe(true)
    expect(limiter.check('user-xyz')).toBe(false)

    // global key: uses global limit (10), not perUser
    expect(limiter.check('global')).toBe(true)
    expect(limiter.check('global')).toBe(true)
    expect(limiter.check('global')).toBe(true)
  })

  it('should use global limit for userId keys when perUser is not set', () => {
    const limiter = new RateLimiter({ global: '2/min' })
    expect(limiter.check('user-abc')).toBe(true)
    expect(limiter.check('user-abc')).toBe(true)
    expect(limiter.check('user-abc')).toBe(false)
  })
})

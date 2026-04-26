import { describe, it, expect, vi } from 'vitest'
import { Logger, redactParams } from '../src/logger.js'

describe('redactParams', () => {
  it('should replace listed keys with [REDACTED]', () => {
    const result = redactParams(
      { username: 'alice', password: 'secret', role: 'admin' },
      ['password']
    )
    expect(result).toEqual({ username: 'alice', password: '[REDACTED]', role: 'admin' })
  })

  it('should return original params when no sensitive keys listed', () => {
    const params = { username: 'alice', role: 'admin' }
    const result = redactParams(params, [])
    expect(result).toEqual(params)
  })

  it('should return null unchanged', () => {
    expect(redactParams(null, ['password'])).toBeNull()
  })

  it('should not mutate the original params object', () => {
    const params = { password: 'secret' }
    redactParams(params, ['password'])
    expect(params.password).toBe('secret')
  })
})

describe('Logger.warn', () => {
  it('should emit a JSON warn line to console.warn', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const logger = new Logger()
    logger.warn('test warning', { detail: 'x' })
    expect(spy).toHaveBeenCalledOnce()
    const output = spy.mock.calls[0][0] as string
    const parsed = JSON.parse(output)
    expect(parsed.level).toBe('warn')
    expect(parsed.message).toBe('test warning')
    spy.mockRestore()
  })
})

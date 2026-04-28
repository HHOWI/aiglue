import { describe, it, expect } from 'vitest'
import { IdempotencyStore } from '../src/idempotency.js'
import type { AIEResponse } from '../src/types.js'

const sampleResponse: AIEResponse = {
  type: 'action',
  status: 'success',
  message: 'done',
}

describe('IdempotencyStore', () => {
  it('returns null for unknown keys', () => {
    const store = new IdempotencyStore()
    expect(store.get('missing')).toBeNull()
  })

  it('returns recorded response for valid key within TTL', () => {
    const store = new IdempotencyStore(1000)
    store.record('k1', sampleResponse)
    expect(store.get('k1')).toEqual(sampleResponse)
  })

  it('expires entries past TTL and removes them from the map', async () => {
    const store = new IdempotencyStore(20)
    store.record('k1', sampleResponse)
    expect(store.size()).toBe(1)

    await new Promise((r) => setTimeout(r, 40))
    expect(store.get('k1')).toBeNull()
    expect(store.size()).toBe(0)
  })

  it('isolates entries by key', () => {
    const store = new IdempotencyStore()
    const a: AIEResponse = { type: 'text', content: 'A' }
    const b: AIEResponse = { type: 'text', content: 'B' }
    store.record('a', a)
    store.record('b', b)
    expect(store.get('a')).toEqual(a)
    expect(store.get('b')).toEqual(b)
  })
})

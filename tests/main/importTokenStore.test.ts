import { describe, expect, it } from 'vitest'

import { ImportTokenStore } from '../../src/main/database/importTokenStore'

describe('ImportTokenStore', () => {
  it('expires tokens after ten minutes and removes them after a successful take', () => {
    const store = new ImportTokenStore<string>(10 * 60 * 1000)
    const createdAt = 1_000
    const token = store.put('payload', 'sender-1', createdAt)

    expect(store.take(token, 'sender-1', createdAt + 9 * 60 * 1000)).toBe('payload')
    expect(() => store.take(token, 'sender-1', createdAt + 9 * 60 * 1000)).toThrow('IMPORT_NOT_READY')
  })

  it('rejects a different owner and cleans expired entries', () => {
    const store = new ImportTokenStore<string>(10 * 60 * 1000)
    const token = store.put('payload', 'sender-1', 1_000)

    expect(() => store.take(token, 'sender-2', 2_000)).toThrow('INVALID_ARGUMENT')
    expect(() => store.take(token, 'sender-1', 601_001)).toThrow('IMPORT_NOT_READY')
    expect(store.size).toBe(0)
  })
})

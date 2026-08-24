import { describe, expect, it } from 'vitest'
import { buildFtsQuery } from '../../src/main/search/ftsQuery'

describe('buildFtsQuery', () => {
  it('quotes terms and joins them with AND', () => {
    expect(buildFtsQuery('alpha beta')).toBe('"alpha" AND "beta"')
  })

  it('treats quotes and operators as literal search text', () => {
    expect(buildFtsQuery('alpha "beta" OR gamma')).toBe('"alpha" AND "beta" AND "OR" AND "gamma"')
  })

  it('rejects empty search text', () => {
    expect(() => buildFtsQuery('   ')).toThrow('Search text is empty')
  })
})

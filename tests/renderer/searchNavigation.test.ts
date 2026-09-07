import { describe, expect, it } from 'vitest'
import { getNextSearchIndex } from '../../src/renderer/src/lib/searchNavigation'

describe('search keyboard navigation', () => {
  it('wraps selection and starts at the first result when moving down', () => {
    expect(getNextSearchIndex(null, 3, 1)).toBe(0)
    expect(getNextSearchIndex(2, 3, 1)).toBe(0)
    expect(getNextSearchIndex(0, 3, -1)).toBe(2)
    expect(getNextSearchIndex(null, 0, 1)).toBeNull()
  })
})

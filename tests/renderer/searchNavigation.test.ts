import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getNextSearchIndex } from '../../src/renderer/src/lib/searchNavigation'

describe('search keyboard navigation', () => {
  it('wraps selection and starts at the first result when moving down', () => {
    expect(getNextSearchIndex(null, 3, 1)).toBe(0)
    expect(getNextSearchIndex(2, 3, 1)).toBe(0)
    expect(getNextSearchIndex(0, 3, -1)).toBe(2)
    expect(getNextSearchIndex(null, 0, 1)).toBeNull()
  })

  it('wires focus, selected-result scrolling, Enter activation, and explicit stale-result retirement', () => {
    const component = readFileSync(resolve(__dirname, '../../src/renderer/src/components/GlobalSearch.tsx'), 'utf8')

    expect(component).toContain('inputRef.current?.focus()')
    expect(component).toContain("scrollIntoView({ block: 'nearest' })")
    expect(component).toContain('onOpenResult(items[activeIndex])')
    expect(component).toContain('controllerRef.current?.abort()')
    expect(component).toContain('gate.next()')
  })
})

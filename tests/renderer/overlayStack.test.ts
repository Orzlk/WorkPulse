import { describe, expect, it } from 'vitest'
import { createOverlayStack } from '../../src/renderer/src/components/OverlayStack'

describe('overlay stack', () => {
  it('closes only the highest priority overlay', () => {
    const closed: string[] = []
    const stack = createOverlayStack()
    stack.register({ id: 'search', priority: 10, requestClose: () => { closed.push('search'); return true } })
    stack.register({ id: 'drawer', priority: 20, requestClose: () => { closed.push('drawer'); return true } })

    expect(stack.closeTopOverlay()).toBe(true)
    expect(closed).toEqual(['drawer'])
    expect(stack.closeTopOverlay()).toBe(true)
    expect(closed).toEqual(['drawer', 'search'])
    expect(stack.closeTopOverlay()).toBe(false)
  })

  it('keeps a dirty overlay registered when discard is cancelled', () => {
    const closed: string[] = []
    const stack = createOverlayStack()
    stack.register({ id: 'search', priority: 10, requestClose: () => { closed.push('search'); return true } })
    stack.register({ id: 'drawer', priority: 100, requestClose: () => false })

    expect(stack.closeTopOverlay()).toBe(true)
    expect(stack.closeTopOverlay()).toBe(true)
    expect(closed).toEqual([])
  })

  it('lets Esc close the highest confirmation before a drawer or search', () => {
    const closed: string[] = []
    const stack = createOverlayStack()
    stack.register({ id: 'search', priority: 20, requestClose: () => { closed.push('search'); return true } })
    stack.register({ id: 'drawer', priority: 100, requestClose: () => { closed.push('drawer'); return true } })
    stack.register({ id: 'confirm', priority: 200, requestClose: () => { closed.push('confirm'); return true } })

    expect(stack.closeTopOverlay()).toBe(true)
    expect(closed).toEqual(['confirm'])
  })
})

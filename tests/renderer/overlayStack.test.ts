import { describe, expect, it } from 'vitest'
import { createOverlayStack } from '../../src/renderer/src/components/OverlayStack'

describe('overlay stack', () => {
  it('closes only the highest priority overlay', () => {
    const closed: string[] = []
    const stack = createOverlayStack()
    stack.register({ id: 'search', priority: 10, requestClose: () => { closed.push('search') } })
    stack.register({ id: 'drawer', priority: 20, requestClose: () => { closed.push('drawer') } })

    expect(stack.closeTopOverlay()).toBe(true)
    expect(closed).toEqual(['drawer'])
    expect(stack.closeTopOverlay()).toBe(true)
    expect(closed).toEqual(['drawer', 'search'])
    expect(stack.closeTopOverlay()).toBe(false)
  })
})

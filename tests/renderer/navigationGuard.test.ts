import { describe, expect, it } from 'vitest'
import { createNavigationGuard } from '../../src/renderer/src/lib/navigationGuard'

describe('navigation guard', () => {
  it('allows clean navigation and blocks cancelled dirty navigation', async () => {
    const guard = createNavigationGuard()
    let navigated = false
    guard.register({ id: 'editor', priority: 10, request: () => false })
    expect(await guard.requestNavigation('kanban', () => { navigated = true })).toBe(false)
    expect(navigated).toBe(false)

    guard.unregister('editor')
    expect(await guard.requestNavigation('kanban', () => { navigated = true })).toBe(true)
    expect(navigated).toBe(true)
  })
})

import { describe, expect, it } from 'vitest'

import { showWindowForShortcut } from '../../src/main/window/windowVisibility'

describe('window shortcut visibility', () => {
  it('restores minimized windows before showing and focusing them', () => {
    const calls: string[] = []
    showWindowForShortcut({
      isMinimized: () => true,
      isVisible: () => true,
      restore: () => calls.push('restore'),
      show: () => calls.push('show'),
      focus: () => calls.push('focus')
    })

    expect(calls).toEqual(['restore', 'show', 'focus'])
  })
})

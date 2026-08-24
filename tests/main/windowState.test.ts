import { describe, expect, it } from 'vitest'

import { readMainWindowSize, saveMainWindowSize } from '../../src/main/windowState'

describe('main window state', () => {
  it('uses defaults when no persisted dimensions exist', () => {
    expect(readMainWindowSize(() => null)).toEqual({ width: 800, height: 600 })
  })

  it('restores valid persisted dimensions and rejects invalid or undersized values', () => {
    const values = new Map([
      ['main_window_width', '1280'],
      ['main_window_height', '840']
    ])
    expect(readMainWindowSize((key) => values.get(key) ?? null)).toEqual({ width: 1280, height: 840 })

    values.set('main_window_width', '399')
    values.set('main_window_height', 'not-a-number')
    expect(readMainWindowSize((key) => values.get(key) ?? null)).toEqual({ width: 800, height: 600 })
  })

  it('rounds and persists the last normal window dimensions', () => {
    const values = new Map<string, string>()
    saveMainWindowSize((key, value) => values.set(key, value), { width: 1100.6, height: 720.2 })
    expect(values).toEqual(new Map([
      ['main_window_width', '1101'],
      ['main_window_height', '720']
    ]))
  })
})

import { describe, expect, it } from 'vitest'

import {
  buildTaskCreateQuery,
  buildTaskCreateTitleBarOverlay,
  parseTaskCreateQuery,
  shouldPromptTaskCreateClose
} from '../../src/main/taskCreateWindow'

describe('taskCreateWindow', () => {
  it('builds and parses the task creation window query', () => {
    const query = buildTaskCreateQuery()

    expect(query).toBe('?window=task-create')
    expect(parseTaskCreateQuery(query)).toBe(true)
  })

  it.each(['', '?window=main', '?window=task-editor'])('rejects non-task creation windows: %s', (query) => {
    expect(parseTaskCreateQuery(query)).toBe(false)
  })

  it.each([
    [true, false, true],
    [false, false, false],
    [true, true, false]
  ] as const)('only prompts when the task draft is dirty and the app is not quitting', (isDirty, isQuitting, expected) => {
    expect(shouldPromptTaskCreateClose(isDirty, isQuitting)).toBe(expected)
  })

  it('builds theme-aware title bar overlay colors for the hidden title bar', () => {
    expect(buildTaskCreateTitleBarOverlay(false)).toEqual({ color: '#f7f8fa', symbolColor: '#303236', height: 36 })
    expect(buildTaskCreateTitleBarOverlay(true)).toEqual({ color: '#17191d', symbolColor: '#f4f5f6', height: 36 })
  })
})

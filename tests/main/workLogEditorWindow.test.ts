import { describe, expect, it } from 'vitest'

import {
  buildWorkLogEditorQuery,
  parseWorkLogEditorQuery,
  shouldPromptWorkLogEditorClose
} from '../../src/main/workLogEditorWindow'

describe('workLogEditorWindow', () => {
  it('builds and parses an encoded work log editor query', () => {
    const query = buildWorkLogEditorQuery('log/with spaces')

    expect(query).toBe('?window=worklog-editor&log=log%2Fwith+spaces')
    expect(parseWorkLogEditorQuery(query)).toBe('log/with spaces')
  })

  it('ignores non-editor windows and missing log ids', () => {
    expect(parseWorkLogEditorQuery('?window=main&log=abc')).toBeNull()
    expect(parseWorkLogEditorQuery('?window=worklog-editor')).toBeNull()
    expect(parseWorkLogEditorQuery('')).toBeNull()
  })

  it.each([
    [true, false, true],
    [false, false, false],
    [true, true, false]
  ] as const)('only prompts when dirty and the app is not quitting', (isDirty, isQuitting, expected) => {
    expect(shouldPromptWorkLogEditorClose(isDirty, isQuitting)).toBe(expected)
  })
})

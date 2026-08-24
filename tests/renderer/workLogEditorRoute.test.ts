import { describe, expect, it } from 'vitest'

import { parseWorkLogEditorRoute } from '../../src/renderer/src/lib/workLogEditorRoute'

describe('parseWorkLogEditorRoute', () => {
  it('recognizes a work log editor window and decodes its public id', () => {
    expect(parseWorkLogEditorRoute('?window=worklog-editor&log=log%2Fwith+spaces')).toEqual({
      isEditor: true,
      publicId: 'log/with spaces'
    })
  })

  it.each(['', '?window=main&log=abc', '?window=worklog-editor'])('returns the main window route for %s', (search) => {
    expect(parseWorkLogEditorRoute(search)).toEqual({ isEditor: false, publicId: null })
  })
})

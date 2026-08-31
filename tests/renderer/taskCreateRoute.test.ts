import { describe, expect, it } from 'vitest'

import { parseTaskCreateRoute } from '../../src/renderer/src/lib/taskCreateRoute'

describe('parseTaskCreateRoute', () => {
  it('recognizes the independent task creation window', () => {
    expect(parseTaskCreateRoute('?window=task-create')).toEqual({ isTaskCreate: true })
  })

  it.each(['', '?window=main', '?window=worklog-editor'])('returns the main app route for %s', (search) => {
    expect(parseTaskCreateRoute(search)).toEqual({ isTaskCreate: false })
  })
})

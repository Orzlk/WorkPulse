import { describe, expect, it } from 'vitest'

import { buildTaskCreateQuery, parseTaskCreateQuery } from '../../src/main/taskCreateWindow'

describe('taskCreateWindow', () => {
  it('builds and parses the task creation window query', () => {
    const query = buildTaskCreateQuery()

    expect(query).toBe('?window=task-create')
    expect(parseTaskCreateQuery(query)).toBe(true)
  })

  it.each(['', '?window=main', '?window=task-editor'])('rejects non-task creation windows: %s', (query) => {
    expect(parseTaskCreateQuery(query)).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'

import { normalizeTaskBoardState } from '../../src/main/kanban/kanbanState'

describe('task board state', () => {
  it('keeps system columns and task status aligned', () => {
    expect(normalizeTaskBoardState('todo', undefined)).toEqual({ boardColumn: 'todo', status: 'todo' })
    expect(normalizeTaskBoardState('done', undefined)).toEqual({ boardColumn: 'done', status: 'done' })
    expect(() => normalizeTaskBoardState('todo', 'done')).toThrow('INVALID_ARGUMENT')
  })

  it('accepts matching explicit status', () => {
    expect(normalizeTaskBoardState('in_progress', 'in_progress')).toEqual({
      boardColumn: 'in_progress',
      status: 'in_progress'
    })
  })
})

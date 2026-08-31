import { describe, expect, it } from 'vitest'
import * as kanbanBoard from '../../src/renderer/src/lib/kanbanBoard'
import { filterAndSortTasks } from '../../src/renderer/src/lib/kanbanBoard'

const tasks = [
  {
    id: 1,
    title: '发布客户端',
    description: '准备发布说明',
    status: 'in_progress' as const,
    board_column: 'in_progress',
    position: 1,
    due_date: '2026-08-29',
    priority: 'high' as const,
    project_id: 'project-a',
    repository_id: null,
    tag_names: ['发布']
  },
  {
    id: 2,
    title: '整理文档',
    description: '',
    status: 'todo' as const,
    board_column: 'todo',
    position: 0,
    due_date: null,
    priority: 'low' as const,
    project_id: 'project-b',
    repository_id: 'repo-a',
    tag_names: ['文档']
  },
  {
    id: 3,
    title: '已完成回顾',
    description: '本周回顾',
    status: 'done' as const,
    board_column: 'done',
    position: 0,
    due_date: '2026-08-27',
    priority: 'medium' as const,
    project_id: null,
    repository_id: null,
    tag_names: []
  }
]

describe('看板视图筛选与排序', () => {
  it('searches title, description and tags without mutating the source list', () => {
    const result = filterAndSortTasks(tasks, { query: '发布', showDone: true, sort: 'manual' })

    expect(result.map((task) => task.id)).toEqual([1])
    expect(tasks.map((task) => task.id)).toEqual([1, 2, 3])
  })

  it('filters completed tasks and orders remaining tasks by priority', () => {
    const result = filterAndSortTasks(tasks, { query: '', showDone: false, sort: 'priority' })

    expect(result.map((task) => task.id)).toEqual([1, 2])
  })

  it('can narrow tasks to a project and overdue due date', () => {
    const result = filterAndSortTasks(tasks, {
      query: '',
      showDone: true,
      projectId: 'project-a',
      due: 'overdue',
      today: '2026-08-30',
      sort: 'manual'
    })

    expect(result.map((task) => task.id)).toEqual([1])
  })

  it('restores a completed task to its source column when completion is undone', () => {
    const buildReopenTaskMove = (kanbanBoard as {
      buildReopenTaskMove?: (move: {
        taskId: number
        targetColumn: string
        targetStatus: 'todo' | 'in_progress' | 'done' | 'draft'
        orderedIds: number[]
        sourceColumn?: string
        sourceTaskIds: number[]
        sourceStatus?: 'todo' | 'in_progress' | 'done' | 'draft'
      }) => unknown
    }).buildReopenTaskMove

    expect(buildReopenTaskMove?.({
      taskId: 7,
      targetColumn: 'done',
      targetStatus: 'done',
      orderedIds: [3, 7, 9],
      sourceColumn: 'in_progress',
      sourceTaskIds: [2, 5],
      sourceStatus: 'in_progress'
    })).toEqual({
      taskIds: [2, 5, 7],
      boardColumn: 'in_progress',
      status: 'in_progress',
      sourceBoardColumn: 'done',
      sourceTaskIds: [3, 9],
      sourceStatus: 'done'
    })
  })
})

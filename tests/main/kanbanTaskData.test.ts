import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let electronUserDataPath = ''

vi.mock('electron', () => ({
  app: {
    getPath: () => electronUserDataPath
  }
}))

import { addTask, deleteTask, getDatabase, initDatabase, reorderTasks, restoreTask } from '../../src/main/db'

const temporaryDirectories: string[] = []

function createTemporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'workpulse-kanban-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(() => {
  try {
    getDatabase().close()
  } catch {
    // Database initialization is intentionally lazy in this test suite.
  }
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

describe('看板任务数据', () => {
  it('stores the quick-add date as due_date instead of changing created_at', async () => {
    electronUserDataPath = createTemporaryDirectory()
    await initDatabase()

    const task = addTask('带截止日期的任务', '', 'todo', undefined, {}, 'high', '2026-09-01')

    expect(task.due_date).toBe('2026-09-01')
    expect(task.created_at).not.toContain('2026-09-01')
  })

  it('persists checklist items when creating a task', async () => {
    electronUserDataPath = createTemporaryDirectory()
    await initDatabase()

    const task = addTask('带任务清单的任务', '先完成描述', 'todo', undefined, {}, 'medium', null, [
      { id: 'first', text: '准备测试数据', completed: false },
      { id: 'second', text: '验证创建结果', completed: true }
    ])

    expect(task.checklist).toEqual([
      { id: 'first', text: '准备测试数据', completed: false },
      { id: 'second', text: '验证创建结果', completed: true }
    ])
  })

  it('reindexes both source and destination columns during a move', async () => {
    electronUserDataPath = createTemporaryDirectory()
    await initDatabase()

    const source = addTask('源列任务')
    const destination = addTask('目标列任务')
    const trailing = addTask('目标列第二个任务')

    reorderTasks([destination.id, trailing.id], 'in_progress', 'in_progress', 'todo', [source.id], 'todo')

    const rows = getDatabase()
      .prepare('SELECT id, board_column, status, position FROM tasks ORDER BY board_column, position, id')
      .all()

    expect(rows).toEqual([
      { id: destination.id, board_column: 'in_progress', status: 'in_progress', position: 0 },
      { id: trailing.id, board_column: 'in_progress', status: 'in_progress', position: 1 },
      { id: source.id, board_column: 'todo', status: 'todo', position: 0 }
    ])
  })

  it('keeps a deleted task restorable for an undo action', async () => {
    electronUserDataPath = createTemporaryDirectory()
    await initDatabase()

    const task = addTask('可撤销的任务', '', 'todo', undefined, { tagNames: ['撤销/任务'] })

    expect(deleteTask(task.id)).toBe(true)
    expect(restoreTask(task.id)).toMatchObject({ id: task.id, title: '可撤销的任务', tag_names: ['撤销/任务'] })
  })
})

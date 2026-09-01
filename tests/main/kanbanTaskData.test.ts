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

import { addTask, addWorkLog, cleanupSyncOperations, completeTask, createKanbanColumn, deleteKanbanColumn, deleteTask, getDatabase, getStats, getWorkLogsByDateRange, initDatabase, reorderTasks, restoreTask, updateKanbanColumn, workLogExists } from '../../src/main/db'

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
    expect(task.created_at).not.toBe('2026-09-01')
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

  it('completes a task and its optional work log in one transaction', async () => {
    electronUserDataPath = createTemporaryDirectory()
    await initDatabase()
    const task = addTask('原子完成任务')

    const completed = completeTask(task.id, '完成说明')
    expect(completed).toMatchObject({ id: task.id, status: 'done', board_column: 'done' })
    expect(getDatabase().prepare('SELECT task_id, content FROM work_logs WHERE task_id = ? AND deleted_at IS NULL').get(task.id)).toEqual({ task_id: task.id, content: '完成说明' })
  })

  it('rejects unknown kanban columns instead of hiding a task', async () => {
    electronUserDataPath = createTemporaryDirectory()
    await initDatabase()
    const task = addTask('列校验任务')
    expect(() => reorderTasks([task.id], 'missing_column')).toThrow('Kanban column is invalid')
    expect(getDatabase().prepare('SELECT board_column FROM tasks WHERE id = ?').get(task.id)).toEqual({ board_column: 'todo' })
  })

  it('groups statistics by local calendar dates and keeps tasks out of the log streak', async () => {
    electronUserDataPath = createTemporaryDirectory()
    await initDatabase()
    vi.setSystemTime(new Date('2026-09-01T01:00:00.000Z'))
    try {
      addTask('仅完成任务')
      addWorkLog('本地日期日志', '', null, '2026-08-31T16:30:00.000Z')
      const stats = getStats(3)
      const local = new Date('2026-08-31T16:30:00.000Z')
      const localDate = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`
      expect(stats.daily).toContainEqual({ date: localDate, log_count: 1, task_completed: 0 })
      expect(stats.streak).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('uses local calendar boundaries for date-range reads and import deduplication', async () => {
    electronUserDataPath = createTemporaryDirectory()
    await initDatabase()
    const createdAt = '2026-08-31T16:30:00.000Z'
    addWorkLog('跨日边界日志', '', null, createdAt)
    const local = new Date(createdAt)
    const localDate = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`

    expect(workLogExists('跨日边界日志', '', `${localDate} 12:00:00`)).toBe(true)
    expect(getWorkLogsByDateRange(localDate, localDate).map((log) => log.content)).toContain('跨日边界日志')
  })

  it('records custom kanban column lifecycle operations in the outbox', async () => {
    electronUserDataPath = createTemporaryDirectory()
    await initDatabase()
    const column = createKanbanColumn('待验收')
    updateKanbanColumn(column.public_id, '已验收')
    expect(deleteKanbanColumn(column.public_id)).toBe(true)

    expect(getDatabase().prepare("SELECT entity_type, operation_type FROM sync_operations WHERE entity_type = 'kanban_column' ORDER BY id").all()).toEqual([
      { entity_type: 'kanban_column', operation_type: 'create' },
      { entity_type: 'kanban_column', operation_type: 'update' },
      { entity_type: 'kanban_column', operation_type: 'delete' }
    ])
  })

  it('does not prune pending outbox operations when bounding terminal history', async () => {
    electronUserDataPath = createTemporaryDirectory()
    await initDatabase()
    const database = getDatabase()
    const workspace = database.prepare('SELECT id FROM workspaces ORDER BY id LIMIT 1').get() as { id: number }
    const insert = database.prepare(`
      INSERT INTO sync_operations (public_id, workspace_id, entity_type, entity_public_id, operation_type, payload, created_at, updated_at)
      VALUES (?, ?, 'task', ?, 'update', '{}', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
    `)
    for (let index = 0; index < 5001; index++) insert.run(`pending-${index}`, workspace.id, `task-${index}`)

    expect(cleanupSyncOperations()).toBe(0)
    expect(database.prepare('SELECT COUNT(*) AS count FROM sync_operations WHERE completed_at IS NULL AND failed_at IS NULL').get()).toEqual({ count: 5001 })
  })
})

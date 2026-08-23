import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let userDataPath = ''
vi.mock('electron', () => ({ app: { getPath: () => userDataPath } }))

import { getDatabase, getStats, initDatabase } from '../../src/main/db'
import { parseStatsDays } from '../../src/main/ipcContracts'

const directories: string[] = []

afterEach(() => {
  try { getDatabase().close() } catch { /* database was not opened */ }
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('stats security boundaries', () => {
  it('accepts only bounded safe integer days at the IPC contract boundary', () => {
    expect(parseStatsDays(undefined)).toBe(30)
    expect(parseStatsDays(1)).toBe(1)
    expect(parseStatsDays(366)).toBe(366)

    for (const value of ['7', Number.NaN, Number.POSITIVE_INFINITY, 0, -1, 367, "7') OR 1=1 --"]) {
      expect(() => parseStatsDays(value)).toThrow('INVALID_ARGUMENT')
    }
  })

  it('limits daily and aggregate statistics to the active workspace and records', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'workpulse-stats-security-'))
    directories.push(directory)
    userDataPath = directory
    await initDatabase()

    const database = getDatabase()
    const now = new Date()
    const recent = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString()
    const deletedAt = now.toISOString()
    const timestamp = now.toISOString()

    database.prepare(`
      INSERT INTO workspaces (public_id, name, created_at, updated_at)
      VALUES ('workspace-stats-other', '其他空间', ?, ?)
    `).run(timestamp, timestamp)
    database.prepare(`
      INSERT INTO users (public_id, workspace_id, name, created_at, updated_at)
      VALUES ('user-stats-other', 2, '其他用户', ?, ?)
    `).run(timestamp, timestamp)

    database.prepare(`
      INSERT INTO work_logs (public_id, workspace_id, content, category, created_by, updated_by, created_at, updated_at)
      VALUES ('stats-active-log', 1, '当前空间日志', '', 1, 1, ?, ?)
    `).run(recent, recent)
    database.prepare(`
      INSERT INTO work_logs (public_id, workspace_id, content, category, created_by, updated_by, created_at, updated_at, deleted_at)
      VALUES ('stats-deleted-log', 1, '已删除日志', '', 1, 1, ?, ?, ?)
    `).run(recent, recent, deletedAt)
    database.prepare(`
      INSERT INTO work_logs (public_id, workspace_id, content, category, created_by, updated_by, created_at, updated_at)
      VALUES ('stats-other-log', 2, '其他空间日志', '', 2, 2, ?, ?)
    `).run(recent, recent)

    database.prepare(`
      INSERT INTO tasks (public_id, workspace_id, title, description, status, board_column, position, created_by, updated_by, created_at, updated_at, completed_at)
      VALUES ('stats-done-task', 1, '当前空间已完成', '', 'done', 'done', 0, 1, 1, ?, ?, ?)
    `).run(recent, recent, recent)
    database.prepare(`
      INSERT INTO tasks (public_id, workspace_id, title, description, status, board_column, position, created_by, updated_by, created_at, updated_at, deleted_at, completed_at)
      VALUES ('stats-deleted-task', 1, '已删除任务', '', 'done', 'done', 1, 1, 1, ?, ?, ?, ?)
    `).run(recent, recent, deletedAt, recent)
    database.prepare(`
      INSERT INTO tasks (public_id, workspace_id, title, description, status, board_column, position, created_by, updated_by, created_at, updated_at, completed_at)
      VALUES ('stats-other-task', 2, '其他空间任务', '', 'done', 'done', 0, 2, 2, ?, ?, ?)
    `).run(recent, recent, recent)

    const stats = getStats(7)

    expect(stats.daily).toEqual([
      expect.objectContaining({ log_count: 1, task_completed: 1 })
    ])
    expect(stats.totalLogs).toBe(1)
    expect(stats.totalTasksDone).toBe(1)
    expect(stats.totalTasksActive).toBe(0)
    expect(() => getStats(0)).toThrow(RangeError)
    expect(() => getStats("7') OR 1=1 --" as unknown as number)).toThrow(RangeError)
  })
})

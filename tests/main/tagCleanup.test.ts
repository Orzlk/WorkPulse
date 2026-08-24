import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let userDataPath = ''
vi.mock('electron', () => ({ app: { getPath: () => userDataPath } }))

import { addTask, addWorkLog, deleteTask, deleteWorkLog, getDatabase, initDatabase, restoreWorkLog } from '../../src/main/db'

const directories: string[] = []

afterEach(() => {
  try { getDatabase().close() } catch { /* database was not opened */ }
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('tag cleanup', () => {
  it('soft-deletes tags after the last content in a tag path is removed', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'workpulse-tag-cleanup-'))
    directories.push(directory)
    userDataPath = directory
    await initDatabase()

    const parent = addWorkLog('父标签内容', '', null, '2026-08-20T10:00:00.000Z', { tagNames: ['工作'] })
    const child = addWorkLog('子标签内容', '', null, '2026-08-20T09:00:00.000Z', { tagNames: ['工作/三峡'] })
    const sibling = addWorkLog('兄弟标签内容', '', null, '2026-08-20T08:00:00.000Z', { tagNames: ['工作/研发'] })

    deleteWorkLog(child.id)
    expect(getDatabase().prepare('SELECT path FROM tags WHERE workspace_id = 1 AND deleted_at IS NULL ORDER BY path').all()).toEqual([
      { path: '工作' },
      { path: '工作/研发' }
    ])

    deleteWorkLog(sibling.id)
    expect(getDatabase().prepare('SELECT path FROM tags WHERE workspace_id = 1 AND deleted_at IS NULL ORDER BY path').all()).toEqual([{ path: '工作' }])

    deleteWorkLog(parent.id)
    expect(getDatabase().prepare('SELECT COUNT(*) AS count FROM tags WHERE workspace_id = 1 AND deleted_at IS NULL').get()).toEqual({ count: 0 })
  })

  it('keeps a tag while another content type still uses it', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'workpulse-tag-cleanup-shared-'))
    directories.push(directory)
    userDataPath = directory
    await initDatabase()

    const log = addWorkLog('日志', '', null, '2026-08-20T10:00:00.000Z', { tagNames: ['共享'] })
    const task = addTask('任务', '', 'todo', '2026-08-20T09:00:00.000Z', { tagNames: ['共享'] })
    deleteWorkLog(log.id)
    expect(getDatabase().prepare('SELECT COUNT(*) AS count FROM tags WHERE path = ? AND deleted_at IS NULL').get('共享')).toEqual({ count: 1 })

    deleteTask(task.id)
    expect(getDatabase().prepare('SELECT COUNT(*) AS count FROM tags WHERE path = ? AND deleted_at IS NULL').get('共享')).toEqual({ count: 0 })
  })

  it('restores tag associations when undoing a deleted log', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'workpulse-tag-cleanup-undo-'))
    directories.push(directory)
    userDataPath = directory
    await initDatabase()

    const log = addWorkLog('可撤销日志', '', null, '2026-08-20T10:00:00.000Z', { tagNames: ['撤销/标签'] })
    deleteWorkLog(log.id)
    expect(getDatabase().prepare('SELECT COUNT(*) AS count FROM tags WHERE path = ? AND deleted_at IS NULL').get('撤销/标签')).toEqual({ count: 0 })

    const restored = restoreWorkLog(log)
    expect(restored.tag_names).toEqual(['撤销/标签'])
    expect(getDatabase().prepare('SELECT COUNT(*) AS count FROM tags WHERE path = ? AND deleted_at IS NULL').get('撤销/标签')).toEqual({ count: 1 })
  })
})

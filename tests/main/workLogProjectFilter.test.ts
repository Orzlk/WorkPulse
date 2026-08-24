import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let userDataPath = ''
vi.mock('electron', () => ({ app: { getPath: () => userDataPath } }))

import { addWorkLog, getDatabase, getWorkLogs, initDatabase, searchWorkLogs } from '../../src/main/db'

const directories: string[] = []

afterEach(() => {
  try { getDatabase().close() } catch { /* database was not opened */ }
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('work log project filter', () => {
  it('filters list and search by project and keeps the tag intersection', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'workpulse-project-filter-'))
    directories.push(directory)
    userDataPath = directory
    await initDatabase()
    const database = getDatabase()
    const now = new Date().toISOString()
    database.prepare(`INSERT INTO projects (public_id, workspace_id, name, description, color, created_by, updated_by, created_at, updated_at) VALUES ('project-a', 1, '项目 A', '', '#64748b', 1, 1, ?, ?), ('project-b', 1, '项目 B', '', '#64748b', 1, 1, ?, ?)`)
      .run(now, now, now, now)

    addWorkLog('项目 A 的工作日志', '', null, '2026-08-20T10:00:00.000Z', { projectId: 'project-a', tagNames: ['工作/研发'] })
    addWorkLog('项目 A 的生活记录', '', null, '2026-08-20T09:00:00.000Z', { projectId: 'project-a', tagNames: ['生活'] })
    addWorkLog('项目 B 的工作日志', '', null, '2026-08-20T08:00:00.000Z', { projectId: 'project-b', tagNames: ['工作/研发'] })

    expect(getWorkLogs(50, 0, undefined, 'project-a').map((log) => log.content)).toEqual([
      '项目 A 的工作日志',
      '项目 A 的生活记录'
    ])
    expect(getWorkLogs(50, 0, '工作', 'project-a').map((log) => log.content)).toEqual(['项目 A 的工作日志'])
    expect(searchWorkLogs('工作日志', 50, undefined, 'project-b').map((log) => log.content)).toEqual(['项目 B 的工作日志'])
  })
})

import Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let userDataPath = ''
vi.mock('electron', () => ({ app: { getPath: () => userDataPath } }))

import { addTask, addWorkLog, getDatabase, getTasks, getWorkLogs, initDatabase, updateTask, updateWorkLog } from '../../src/main/db'

const directories: string[] = []

afterEach(() => {
  try { getDatabase().close() } catch { /* database was not opened */ }
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('work item associations', () => {
  it('persists project, repository, tags and audit outbox for logs and tasks', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'workpulse-associations-'))
    directories.push(directory)
    userDataPath = directory
    await initDatabase()
    const database = getDatabase()
    const now = new Date().toISOString()
    database.prepare(`INSERT INTO projects (public_id, workspace_id, name, description, color, created_by, updated_by, created_at, updated_at) VALUES ('project-1', 1, '项目', '', '#64748b', 1, 1, ?, ?)`)
      .run(now, now)
    database.prepare(`INSERT INTO repositories (public_id, workspace_id, project_id, name, enabled, created_by, updated_by, created_at, updated_at) VALUES ('repo-1', 1, 1, '仓库', 1, 1, 1, ?, ?)`)
      .run(now, now)

    const log = addWorkLog('日志内容', '工作', null, undefined, {
      projectId: 'project-1', repositoryId: 'repo-1', tagNames: ['客户端/导出', '回归']
    })
    const task = addTask('任务内容', '', 'todo', undefined, {
      projectId: 'project-1', repositoryId: 'repo-1', tagNames: ['客户端/导出']
    })

    const savedLog = getWorkLogs()[0]
    const savedTask = getTasks()[0]
    expect(savedLog).toMatchObject({ public_id: log.public_id, project_id: 'project-1', repository_id: 'repo-1' })
    expect(savedLog.tag_names.slice().sort()).toEqual(['客户端/导出', '回归'].sort())
    expect(savedTask).toMatchObject({ public_id: task.public_id, project_id: 'project-1', repository_id: 'repo-1', tag_names: ['客户端/导出'] })

    updateWorkLog(log.id, '更新日志', '工作', undefined, { projectId: null, repositoryId: null, tagNames: ['更新'] })
    updateTask(task.id, { project_id: null, repository_id: null, tag_names: ['更新任务'] })
    expect(getWorkLogs()[0]).toMatchObject({ project_id: null, repository_id: null, tag_names: ['更新'] })
    expect(getTasks()[0]).toMatchObject({ project_id: null, repository_id: null, tag_names: ['更新任务'] })
    expect((database.prepare("SELECT COUNT(*) AS count FROM sync_operations WHERE entity_type IN ('work_log', 'task', 'work_log_tags', 'task_tags')").get() as { count: number }).count).toBeGreaterThanOrEqual(4)
  })
})

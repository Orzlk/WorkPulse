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
  it('persists project, tags and audit outbox without repository ownership', async () => {
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
      projectId: 'project-1', tagNames: ['客户端/导出', '回归']
    })
    const task = addTask('任务内容', '', 'todo', undefined, {
      projectId: 'project-1', tagNames: ['客户端/导出']
    })

    const savedLog = getWorkLogs()[0]
    const savedTask = getTasks()[0]
    expect(savedLog).toMatchObject({ public_id: log.public_id, project_id: 'project-1' })
    expect(savedLog).not.toHaveProperty('repository_id')
    expect(savedLog.tag_names.slice().sort()).toEqual(['客户端/导出', '回归'].sort())
    expect(savedTask).toMatchObject({ public_id: task.public_id, project_id: 'project-1', tag_names: ['客户端/导出'] })
    expect(savedTask).not.toHaveProperty('repository_id')

    updateWorkLog(log.id, '更新日志', '工作', undefined, { projectId: null, tagNames: ['更新'] })
    updateTask(task.id, { project_id: null, tag_names: ['更新任务'] })
    expect(getWorkLogs()[0]).toMatchObject({ project_id: null, tag_names: ['更新'] })
    expect(getTasks()[0]).toMatchObject({ project_id: null, tag_names: ['更新任务'] })
    expect((database.prepare("SELECT COUNT(*) AS count FROM sync_operations WHERE entity_type IN ('work_log', 'task', 'work_log_tags', 'task_tags')").get() as { count: number }).count).toBeGreaterThanOrEqual(4)
  })

  it('preserves omitted associations and emits patch-shaped outbox payloads', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'workpulse-associations-preserve-'))
    directories.push(directory)
    userDataPath = directory
    await initDatabase()
    const database = getDatabase()
    const now = new Date().toISOString()
    database.prepare(`INSERT INTO projects (public_id, workspace_id, name, description, color, created_by, updated_by, created_at, updated_at) VALUES ('project-keep', 1, 'Project', '', '#64748b', 1, 1, ?, ?)`).run(now, now)
    database.prepare(`INSERT INTO repositories (public_id, workspace_id, project_id, name, enabled, created_by, updated_by, created_at, updated_at) VALUES ('repo-keep', 1, 1, 'Repository', 1, 1, 1, ?, ?)`).run(now, now)

    const log = addWorkLog('Original log', 'work', null, undefined, { projectId: 'project-keep', tagNames: ['keep-log'] })
    const task = addTask('Original task', '', 'todo', undefined, { projectId: 'project-keep', tagNames: ['keep-task'] })

    updateWorkLog(log.id, 'Updated log', 'work')
    updateTask(task.id, { title: 'Updated task' })
    expect(getWorkLogs()[0]).toMatchObject({ project_id: 'project-keep', tag_names: ['keep-log'] })
    expect(getTasks()[0]).toMatchObject({ project_id: 'project-keep', tag_names: ['keep-task'] })

    const payloads = database.prepare(`SELECT payload FROM sync_operations WHERE entity_type IN ('work_log', 'task') ORDER BY id DESC LIMIT 2`).all() as Array<{ payload: string }>
    expect(payloads.every((row) => !Object.prototype.hasOwnProperty.call(JSON.parse(row.payload), 'project_id'))).toBe(true)
    expect(payloads.every((row) => !Object.prototype.hasOwnProperty.call(JSON.parse(row.payload), 'tag_names'))).toBe(true)
    expect(payloads.every((row) => !Object.prototype.hasOwnProperty.call(JSON.parse(row.payload), 'repository_id'))).toBe(true)
  })

  it('rolls back body, tags, links, and outbox when association persistence fails', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'workpulse-associations-rollback-'))
    directories.push(directory)
    userDataPath = directory
    await initDatabase()
    const database = getDatabase()
    database.exec(`CREATE TRIGGER fail_task_outbox BEFORE INSERT ON sync_operations WHEN NEW.entity_type = 'task' BEGIN SELECT RAISE(ABORT, 'forced task outbox failure'); END`)

    expect(() => addTask('Rollback task', '', 'todo', undefined, { tagNames: ['rollback-tag'] })).toThrow('forced task outbox failure')
    expect(database.prepare("SELECT COUNT(*) AS count FROM tasks WHERE title = 'Rollback task'").get()).toEqual({ count: 0 })
    expect(database.prepare("SELECT COUNT(*) AS count FROM tags WHERE path = 'rollback-tag'").get()).toEqual({ count: 0 })
    expect(database.prepare("SELECT COUNT(*) AS count FROM sync_operations WHERE entity_type = 'task'").get()).toEqual({ count: 0 })
  })

  it('keeps legacy CRUD reads and task operations inside the active workspace', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'workpulse-associations-workspace-'))
    directories.push(directory)
    userDataPath = directory
    await initDatabase()
    const database = getDatabase()
    const now = new Date().toISOString()
    database.prepare(`INSERT INTO workspaces (public_id, name, created_at, updated_at) VALUES ('workspace-2', 'Workspace 2', ?, ?)`).run(now, now)
    database.prepare(`INSERT INTO users (public_id, workspace_id, name, created_at, updated_at) VALUES ('user-2', 2, 'User 2', ?, ?)`).run(now, now)
    database.prepare(`INSERT INTO tasks (public_id, workspace_id, title, description, status, board_column, position, created_by, updated_by, created_at, updated_at) VALUES ('task-other', 2, 'Other workspace task', '', 'todo', 'todo', 0, 2, 2, ?, ?)`).run(now, now)

    expect(getTasks().some((task) => task.public_id === 'task-other')).toBe(false)
    expect(() => updateTask(2, { title: 'Must not update' })).not.toThrow()
    expect(database.prepare("SELECT title FROM tasks WHERE public_id = 'task-other'").get()).toEqual({ title: 'Other workspace task' })
    expect(database.prepare("SELECT COUNT(*) AS count FROM tasks WHERE public_id = 'task-other'").get()).toEqual({ count: 1 })
  })

  it('filters logs by a tag subtree without changing project ownership', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'workpulse-associations-tag-filter-'))
    directories.push(directory)
    userDataPath = directory
    await initDatabase()

    const projectNow = new Date().toISOString()
    getDatabase().prepare(`INSERT INTO projects (public_id, workspace_id, name, description, color, created_by, updated_by, created_at, updated_at) VALUES ('project-filter', 1, '项目', '', '#64748b', 1, 1, ?, ?)`).run(projectNow, projectNow)
    addWorkLog('三峡日志', '', null, '2026-08-20T10:00:00.000Z', {
      projectId: 'project-filter',
      tagNames: ['工作/三峡']
    })
    addWorkLog('研发日志', '', null, '2026-08-20T09:00:00.000Z', {
      tagNames: ['工作/研发']
    })
    addWorkLog('生活日志', '', null, '2026-08-20T08:00:00.000Z', {
      tagNames: ['生活']
    })

    const logs = getWorkLogs(50, 0, '工作')
    expect(logs.map((log) => log.content)).toEqual(['三峡日志', '研发日志'])
    expect(logs[0]).toMatchObject({ project_id: 'project-filter', tag_names: ['工作/三峡'] })
  })
})

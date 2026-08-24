import Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let userDataPath = ''
vi.mock('electron', () => ({ app: { getPath: () => userDataPath } }))

import {
  addTask,
  addWorkLog,
  clearWorkspaceData,
  getDatabase,
  initDatabase,
  saveReport,
  setSetting
} from '../../src/main/db'

const directories: string[] = []

afterEach(() => {
  try { getDatabase().close() } catch { /* database was not opened */ }
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('clearWorkspaceData', () => {
  it('backs up and clears business data while preserving settings and workspace identity', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'workpulse-clear-data-'))
    directories.push(directory)
    userDataPath = directory
    await initDatabase()

    const database = getDatabase()
    const context = database.prepare(`
      SELECT workspaces.id AS workspace_id, users.id AS user_id
      FROM users INNER JOIN workspaces ON workspaces.id = users.workspace_id
      WHERE users.deleted_at IS NULL AND workspaces.deleted_at IS NULL
      ORDER BY users.id LIMIT 1
    `).get() as { workspace_id: number; user_id: number }
    const now = new Date().toISOString()
    const projectResult = database.prepare(`
      INSERT INTO projects (public_id, workspace_id, name, description, color, created_by, updated_by, created_at, updated_at)
      VALUES ('clear-project', ?, '清除项目', '', '#64748b', ?, ?, ?, ?)
    `).run(context.workspace_id, context.user_id, context.user_id, now, now)
    const repositoryResult = database.prepare(`
      INSERT INTO repositories (public_id, workspace_id, project_id, name, remote_url, created_by, updated_by, created_at, updated_at, enabled)
      VALUES ('clear-repository', ?, ?, '清除仓库', NULL, ?, ?, ?, ?, 1)
    `).run(context.workspace_id, projectResult.lastInsertRowid, context.user_id, context.user_id, now, now)
    database.prepare(`
      INSERT INTO repository_bindings (public_id, repository_id, local_path, branch, created_at, updated_at, workspace_id, created_by, updated_by, is_valid)
      VALUES ('clear-binding', ?, 'D:/clear-repository', 'main', ?, ?, ?, ?, ?, 1)
    `).run(repositoryResult.lastInsertRowid, now, now, context.workspace_id, context.user_id, context.user_id)

    const log = addWorkLog('需要清除的日志', '工作', null, undefined, {
      projectId: 'clear-project',
      repositoryId: 'clear-repository',
      tagNames: ['清除/日志']
    })
    const task = addTask('需要清除的任务', '', 'todo', undefined, {
      projectId: 'clear-project',
      repositoryId: 'clear-repository',
      tagNames: ['清除/任务']
    })
    const report = saveReport('weekly', '2026-08-17', '2026-08-23', '需要清除的报告')
    const tagId = database.prepare('SELECT id FROM tags WHERE path = ?').get('清除/日志') as { id: number }

    const inboxResult = database.prepare(`
      INSERT INTO inbox_items (public_id, workspace_id, project_id, repository_id, content, status, created_by, updated_by, created_at, updated_at, state, include_in_reports)
      VALUES ('clear-inbox', ?, ?, ?, '需要清除的收件箱', 'inbox', ?, ?, ?, ?, 'unorganized', 1)
    `).run(context.workspace_id, projectResult.lastInsertRowid, repositoryResult.lastInsertRowid, context.user_id, context.user_id, now, now)
    const commitResult = database.prepare(`
      INSERT INTO git_commits (public_id, workspace_id, repository_id, commit_hash, author_name, author_email, committed_at, message, branch, files_changed, additions, deletions, created_at, updated_at, created_by, updated_by)
      VALUES ('clear-commit', ?, ?, 'clear-hash', 'User', 'user@example.com', ?, '需要清除的提交', 'main', 1, 1, 0, ?, ?, ?, ?)
    `).run(context.workspace_id, repositoryResult.lastInsertRowid, now, now, now, context.user_id, context.user_id)

    database.prepare('INSERT INTO inbox_tags (inbox_item_id, tag_id) VALUES (?, ?)').run(inboxResult.lastInsertRowid, tagId.id)
    database.prepare('INSERT INTO git_commit_tags (git_commit_id, tag_id) VALUES (?, ?)').run(commitResult.lastInsertRowid, tagId.id)
    database.prepare('INSERT INTO report_tags (report_id, tag_id) VALUES (?, ?)').run(report.id, tagId.id)
    database.prepare('INSERT INTO report_projects (report_id, project_id) VALUES (?, ?)').run(report.id, projectResult.lastInsertRowid)
    database.prepare('INSERT INTO report_repositories (report_id, repository_id) VALUES (?, ?)').run(report.id, repositoryResult.lastInsertRowid)
    database.prepare(`
      INSERT INTO sync_operations (public_id, workspace_id, entity_type, entity_public_id, operation_type, payload, created_at, updated_at)
      VALUES ('clear-sync', ?, 'work_log', ?, 'create', '{}', ?, ?)
    `).run(context.workspace_id, log.public_id, now, now)
    setSetting('clear-test-setting', 'must-survive')

    const result = await clearWorkspaceData()
    const backup = new Database(result.backupPath, { readonly: true })
    expect(existsSync(result.backupPath)).toBe(true)
    expect(backup.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }])
    expect(backup.prepare('SELECT COUNT(*) AS count FROM work_logs').get()).toEqual({ count: 1 })
    backup.close()

    for (const table of [
      'work_logs', 'tasks', 'reports', 'projects', 'repositories', 'repository_bindings',
      'inbox_items', 'git_commits', 'tags', 'work_log_tags', 'task_tags', 'inbox_tags',
      'git_commit_tags', 'report_tags', 'report_projects', 'report_repositories',
      'sync_operations', 'content_search'
    ]) {
      expect(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()).toEqual({ count: 0 })
    }
    expect(database.prepare('SELECT value FROM settings WHERE key = ?').get('clear-test-setting')).toEqual({ value: 'must-survive' })
    expect(database.prepare('SELECT COUNT(*) AS count FROM workspaces').get()).toEqual({ count: 1 })
    expect(database.prepare('SELECT COUNT(*) AS count FROM users').get()).toEqual({ count: 1 })
    expect(result.deleted.work_logs).toBe(1)
    expect(result.deleted.tasks).toBe(1)
  })
})

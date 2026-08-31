import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import Database from 'better-sqlite3'

import { openDatabase, runMigrations } from '../../src/main/database/connection'
import type { WorkspaceContext } from '../../src/main/repositories/contracts'
import { InboxService } from '../../src/main/services/inboxService'
import { ProjectService } from '../../src/main/services/projectService'
import { RepositoryService } from '../../src/main/services/repositoryService'

const temporaryDirectories: string[] = []
let database: Database.Database | null = null

function createTemporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  temporaryDirectories.push(directory)
  return directory
}

function getContext(connection: Database.Database): WorkspaceContext {
  return connection.prepare(`
    SELECT workspaces.id AS workspace_id, users.id AS user_id
    FROM workspaces
    INNER JOIN users ON users.workspace_id = workspaces.id
    WHERE workspaces.deleted_at IS NULL AND users.deleted_at IS NULL
    ORDER BY workspaces.id, users.id
    LIMIT 1
  `).get() as WorkspaceContext
}

afterEach(() => {
  database?.close()
  database = null
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('project activity', () => {
  it('returns every active project record in reverse chronological order', () => {
    database = openDatabase(join(createTemporaryDirectory('workpulse-project-activity-'), 'workpulse.db'))
    runMigrations(database)
    const context = getContext(database)
    const projects = new ProjectService(database, context)
    const project = projects.create({ name: '项目活动', description: '', color: '#64748b' })
    const otherProject = projects.create({ name: '其他项目', description: '', color: '#64748b' })

    database.prepare(`
      INSERT INTO work_logs (
        public_id, workspace_id, project_id, content, category,
        created_by, updated_by, created_at, updated_at
      ) VALUES (?, ?, (SELECT id FROM projects WHERE public_id = ?), ?, ?, ?, ?, ?, ?)
    `).run(randomUUID(), context.workspace_id, project.public_id, '项目日志', '研发', context.user_id, context.user_id, '2026-08-20T10:00:00.000Z', '2026-08-20T10:00:00.000Z')
    database.prepare(`
      INSERT INTO work_logs (
        public_id, workspace_id, project_id, content, category,
        created_by, updated_by, created_at, updated_at
      ) VALUES (?, ?, (SELECT id FROM projects WHERE public_id = ?), ?, ?, ?, ?, ?, ?)
    `).run(randomUUID(), context.workspace_id, otherProject.public_id, '其他项目日志', '研发', context.user_id, context.user_id, '2026-08-25T10:00:00.000Z', '2026-08-25T10:00:00.000Z')

    database.prepare(`
      INSERT INTO tasks (
        public_id, workspace_id, project_id, title, description, status, board_column,
        position, created_by, updated_by, created_at, updated_at, priority, checklist
      ) VALUES (?, ?, (SELECT id FROM projects WHERE public_id = ?), ?, '', 'todo', 'todo', 0, ?, ?, ?, ?, 'medium', '[]')
    `).run(randomUUID(), context.workspace_id, project.public_id, '项目任务', context.user_id, context.user_id, '2026-08-24T10:00:00.000Z', '2026-08-24T10:00:00.000Z')

    const repositories = new RepositoryService(database, context)
    const repository = repositories.create({ name: '项目仓库', local_path: createTemporaryDirectory('workpulse-project-repo-'), project_id: project.public_id })
    database.prepare(`
      INSERT INTO git_commits (
        public_id, workspace_id, repository_id, commit_hash, author_name, author_email,
        committed_at, message, branch, files_changed, additions, deletions,
        created_by, updated_by, created_at, updated_at
      ) VALUES (?, ?, (SELECT id FROM repositories WHERE public_id = ?), ?, ?, ?, ?, ?, ?, 2, 8, 1, ?, ?, ?, ?)
    `).run(randomUUID(), context.workspace_id, repository.public_id, 'abc123', '开发者', 'dev@example.com', '2026-08-22T10:00:00.000Z', '完成项目功能', 'main', context.user_id, context.user_id, '2026-08-22T10:00:00.000Z', '2026-08-22T10:00:00.000Z')

    const inbox = new InboxService(database, context).create({ content: '项目收件箱', project_id: project.public_id })
    database.prepare('UPDATE inbox_items SET created_at = ?, updated_at = ? WHERE public_id = ?').run('2026-08-23T10:00:00.000Z', '2026-08-23T10:00:00.000Z', inbox.public_id)

    database.prepare(`
      INSERT INTO reports (
        public_id, workspace_id, type, period_type, date_from, date_to, period_start,
        period_end_exclusive, time_zone, timezone, project_scope, repository_scope,
        source_snapshot, content, version, status, retry_count, created_by, updated_by,
        created_at, updated_at, generated_at
      ) VALUES (?, ?, 'weekly', 'weekly', '2026-08-17', '2026-08-23', ?, ?, 'Asia/Shanghai', 'Asia/Shanghai', ?, '[]', ?, '项目报告内容', 1, 'ready', 0, ?, ?, ?, ?, ?)
    `).run(randomUUID(), context.workspace_id, '2026-08-17T00:00:00.000Z', '2026-08-24T00:00:00.000Z', JSON.stringify([project.public_id]), JSON.stringify({ projects: [{ public_id: project.public_id }] }), context.user_id, context.user_id, '2026-08-21T10:00:00.000Z', '2026-08-21T10:00:00.000Z', '2026-08-21T10:00:00.000Z')

    const activity = projects.activity(project.public_id)

    expect(activity.map((item) => item.type)).toEqual(['task', 'inbox', 'git_commit', 'report', 'work_log'])
    expect(activity.map((item) => item.occurred_at)).toEqual([
      '2026-08-24T10:00:00.000Z',
      '2026-08-23T10:00:00.000Z',
      '2026-08-22T10:00:00.000Z',
      '2026-08-21T10:00:00.000Z',
      '2026-08-20T10:00:00.000Z'
    ])
    expect(activity[2]).toMatchObject({ title: '完成项目功能', repository_name: '项目仓库', author_name: '开发者', commit_hash: 'abc123' })
    expect(activity[3]).toMatchObject({ title: 'weekly', content: '项目报告内容' })
    expect(projects.list().items.find((item) => item.public_id === project.public_id)?.summary.reports).toBe(1)
  })
})

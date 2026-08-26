import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

import { runMigrations } from '../../src/main/database/migrations'
import {
  createDatabaseExport,
  mergeDatabaseImport,
  previewDatabaseImport,
  type DatabaseTransferPackage
} from '../../src/main/database/transfer'

function createDatabase(): Database.Database {
  const database = new Database(':memory:')
  runMigrations(database)
  return database
}

function context(database: Database.Database): { workspace_id: number; user_id: number } {
  return database.prepare('SELECT workspace_id, id AS user_id FROM users ORDER BY id LIMIT 1').get() as {
    workspace_id: number
    user_id: number
  }
}

interface WorkspaceGraph {
  workspaceId: number
  userId: number
  projectId: number
  repositoryId: number
  taskId: number
  workLogId: number
  inboxItemId: number
  tagId: number
  gitCommitId: number
  reportId: number
}

function createWorkspace(database: Database.Database, suffix: string): { workspaceId: number; userId: number } {
  const workspace = database.prepare(`
    INSERT INTO workspaces (public_id, name, created_at, updated_at)
    VALUES (?, ?, '2026-08-23T00:00:00.000Z', '2026-08-23T00:00:00.000Z')
  `).run(`workspace-${suffix}`, `空间-${suffix}`)
  const user = database.prepare(`
    INSERT INTO users (public_id, workspace_id, name, created_at, updated_at)
    VALUES (?, ?, ?, '2026-08-23T00:00:00.000Z', '2026-08-23T00:00:00.000Z')
  `).run(`user-${suffix}`, workspace.lastInsertRowid, `用户-${suffix}`)
  return { workspaceId: Number(workspace.lastInsertRowid), userId: Number(user.lastInsertRowid) }
}

function addWorkspaceGraph(
  database: Database.Database,
  workspaceId: number,
  userId: number,
  suffix: string
): WorkspaceGraph {
  const timestamp = '2026-08-23T00:00:00.000Z'
  const project = database.prepare(`
    INSERT INTO projects (public_id, workspace_id, name, description, color, created_by, updated_by, created_at, updated_at)
    VALUES (?, ?, ?, '', '#111111', ?, ?, ?, ?)
  `).run(`project-${suffix}`, workspaceId, `项目-${suffix}`, userId, userId, timestamp, timestamp)
  const projectId = Number(project.lastInsertRowid)
  const repository = database.prepare(`
    INSERT INTO repositories (public_id, workspace_id, name, remote_url, project_id, enabled, created_by, updated_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
  `).run(`repository-${suffix}`, workspaceId, `仓库-${suffix}`, `https://example.com/${suffix}.git`, projectId, userId, userId, timestamp, timestamp)
  const repositoryId = Number(repository.lastInsertRowid)
  database.prepare(`
    INSERT INTO repository_bindings (public_id, repository_id, workspace_id, local_path, branch, is_valid, created_by, updated_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'main', 1, ?, ?, ?, ?)
  `).run(`binding-${suffix}`, repositoryId, workspaceId, `Z:/${suffix}`, userId, userId, timestamp, timestamp)
  const task = database.prepare(`
    INSERT INTO tasks (public_id, workspace_id, project_id, repository_id, title, description, status, board_column, position, created_by, updated_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, '', 'todo', 'todo', 0, ?, ?, ?, ?)
  `).run(`task-${suffix}`, workspaceId, projectId, repositoryId, `任务-${suffix}`, userId, userId, timestamp, timestamp)
  const taskId = Number(task.lastInsertRowid)
  const workLog = database.prepare(`
    INSERT INTO work_logs (public_id, workspace_id, project_id, repository_id, task_id, content, category, created_by, updated_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?)
  `).run(`work-log-${suffix}`, workspaceId, projectId, repositoryId, taskId, `日志-${suffix}`, userId, userId, timestamp, timestamp)
  const workLogId = Number(workLog.lastInsertRowid)
  const inboxItem = database.prepare(`
    INSERT INTO inbox_items (public_id, workspace_id, project_id, repository_id, content, status, state, include_in_reports, created_by, updated_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'inbox', 'unorganized', 1, ?, ?, ?, ?)
  `).run(`inbox-${suffix}`, workspaceId, projectId, repositoryId, `收件箱-${suffix}`, userId, userId, timestamp, timestamp)
  const inboxItemId = Number(inboxItem.lastInsertRowid)
  const tag = database.prepare(`
    INSERT INTO tags (public_id, workspace_id, name, path, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(`tag-${suffix}`, workspaceId, `标签-${suffix}`, `标签-${suffix}`, timestamp, timestamp)
  const tagId = Number(tag.lastInsertRowid)
  const commit = database.prepare(`
    INSERT INTO git_commits (public_id, workspace_id, repository_id, commit_hash, author_name, author_email, committed_at, message, branch, files_changed, additions, deletions, created_by, updated_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, '作者', 'author@example.com', ?, ?, 'main', 1, 2, 1, ?, ?, ?, ?)
  `).run(`commit-${suffix}`, workspaceId, repositoryId, `hash-${suffix}`, timestamp, `提交-${suffix}`, userId, userId, timestamp, timestamp)
  const gitCommitId = Number(commit.lastInsertRowid)
  const report = database.prepare(`
    INSERT INTO reports (
      public_id, workspace_id, type, period_type, date_from, date_to, period_start, period_end_exclusive,
      time_zone, timezone, project_scope, repository_scope, source_snapshot, content, version, status,
      error_message, retry_count, created_by, updated_by, created_at, updated_at
    ) VALUES (?, ?, 'weekly', 'weekly', '2026-08-17', '2026-08-23', ?, ?, 'UTC', 'UTC', '[]', '[]', '{}', ?, 1, 'ready', NULL, 0, ?, ?, ?, ?)
  `).run(`report-${suffix}`, workspaceId, timestamp, '2026-08-24T00:00:00.000Z', `报告-${suffix}`, userId, userId, timestamp, timestamp)
  const reportId = Number(report.lastInsertRowid)

  database.prepare('INSERT INTO work_log_tags (work_log_id, tag_id) VALUES (?, ?)').run(workLogId, tagId)
  database.prepare('INSERT INTO task_tags (task_id, tag_id) VALUES (?, ?)').run(taskId, tagId)
  database.prepare('INSERT INTO inbox_tags (inbox_item_id, tag_id) VALUES (?, ?)').run(inboxItemId, tagId)
  database.prepare('INSERT INTO git_commit_tags (git_commit_id, tag_id) VALUES (?, ?)').run(gitCommitId, tagId)
  database.prepare('INSERT INTO report_tags (report_id, tag_id) VALUES (?, ?)').run(reportId, tagId)
  database.prepare('INSERT INTO report_projects (report_id, project_id) VALUES (?, ?)').run(reportId, projectId)
  database.prepare('INSERT INTO report_repositories (report_id, repository_id) VALUES (?, ?)').run(reportId, repositoryId)
  database.prepare(`
    INSERT INTO sync_operations (public_id, workspace_id, entity_type, entity_public_id, operation_type, payload, created_at, updated_at)
    VALUES (?, ?, 'project', ?, 'create', '{}', ?, ?)
  `).run(`sync-${suffix}`, workspaceId, `project-${suffix}`, timestamp, timestamp)

  return { workspaceId, userId, projectId, repositoryId, taskId, workLogId, inboxItemId, tagId, gitCommitId, reportId }
}

describe('database transfer package', () => {
  it('exports a versioned package without settings or API keys', () => {
    const database = createDatabase()
    const { workspace_id, user_id } = context(database)
    database.prepare(`INSERT INTO settings (key, value, public_id, workspace_id, created_by, updated_by, created_at, updated_at)
      VALUES ('api_key', 'secret-value', 'setting-1', ?, ?, ?, '2026-08-23T00:00:00.000Z', '2026-08-23T00:00:00.000Z')`)
      .run(workspace_id, user_id, user_id)
    database.prepare(`INSERT INTO projects (public_id, workspace_id, name, description, color, created_by, updated_by, created_at, updated_at)
      VALUES ('project-1', ?, '项目', '', '#111111', ?, ?, '2026-08-23T00:00:00.000Z', '2026-08-23T00:00:00.000Z')`)
      .run(workspace_id, user_id, user_id)
    database.prepare(`INSERT INTO kanban_columns (public_id, workspace_id, column_key, name, status, position, is_system, created_at, updated_at)
      VALUES ('column-1', ?, 'custom_review', '待审核', 'in_progress', 3, 0, '2026-08-23T00:00:00.000Z', '2026-08-23T00:00:00.000Z')`)
      .run(workspace_id)

    const exported = createDatabaseExport(database, context(database))

    expect(exported.schema_version).toBe(1)
    expect(exported.tables.projects).toHaveLength(1)
    expect(exported.tables.kanban_columns).toHaveLength(1)
    expect(JSON.stringify(exported)).not.toContain('secret-value')
    expect(exported.tables.settings).toBeUndefined()
    expect(exported.tables.projects?.[0]).not.toHaveProperty('future_secret')
    expect(JSON.stringify(exported)).not.toContain('local_path')
    database.close()
  })

  it('rejects unknown input columns, unsupported future schema and oversized exports', () => {
    const database = createDatabase()
    const packageWithSecret = createDatabaseExport(database, context(database)) as DatabaseTransferPackage
    packageWithSecret.tables.projects = [{
      id: 1,
      public_id: 'project-future',
      name: '项目',
      description: '',
      color: '#111111',
      created_at: '2026-08-23T00:00:00.000Z',
      updated_at: '2026-08-23T00:00:00.000Z',
      future_secret: 'do-not-ignore'
    }]
    expect(() => previewDatabaseImport(packageWithSecret)).toThrow('IMPORT_INVALID')
    expect(() => previewDatabaseImport({ ...packageWithSecret, schema_version: 2 })).toThrow('IMPORT_INVALID')

    database.prepare(`INSERT INTO work_logs (public_id, workspace_id, content, created_at, updated_at)
      VALUES ('large-log', ?, ?, '2026-08-23T00:00:00.000Z', '2026-08-23T00:00:00.000Z')`)
      .run(context(database).workspace_id, 'x'.repeat(20 * 1024 * 1024))
    expect(() => createDatabaseExport(database, context(database))).toThrow('IMPORT_TOO_LARGE')
    database.close()
  })

  it('previews then merges public ids without overwriting or duplicating rows', () => {
    const source = createDatabase()
    const sourceContext = context(source)
    source.prepare(`INSERT INTO projects (public_id, workspace_id, name, description, color, created_by, updated_by, created_at, updated_at)
      VALUES ('project-1', ?, '导入项目', '', '#111111', ?, ?, '2026-08-23T00:00:00.000Z', '2026-08-23T00:00:00.000Z')`)
      .run(sourceContext.workspace_id, sourceContext.user_id, sourceContext.user_id)
    const packageData = createDatabaseExport(source, sourceContext)

    const target = createDatabase()
    expect(previewDatabaseImport(packageData).records.projects).toBe(1)
    expect(mergeDatabaseImport(target, context(target), packageData).inserted).toBe(1)
    expect(mergeDatabaseImport(target, context(target), packageData)).toMatchObject({ inserted: 0, conflicts: 1 })
    expect(target.prepare("SELECT name FROM projects WHERE public_id = 'project-1'").get()).toEqual({ name: '导入项目' })
    source.close()
    target.close()
  })

  it('imports repository bindings as unavailable without probing their local paths', () => {
    const source = createDatabase()
    const sourceContext = context(source)
    source.prepare(`INSERT INTO repositories (public_id, workspace_id, name, enabled, created_by, updated_by, created_at, updated_at)
      VALUES ('repository-1', ?, 'repo', 1, ?, ?, '2026-08-23T00:00:00.000Z', '2026-08-23T00:00:00.000Z')`)
      .run(sourceContext.workspace_id, sourceContext.user_id, sourceContext.user_id)
    const repositoryId = (source.prepare("SELECT id FROM repositories WHERE public_id = 'repository-1'").get() as { id: number }).id
    source.prepare(`INSERT INTO repository_bindings (public_id, repository_id, workspace_id, local_path, is_valid, created_by, updated_by, created_at, updated_at)
      VALUES ('binding-1', ?, ?, 'Z:/unknown-path', 1, ?, ?, '2026-08-23T00:00:00.000Z', '2026-08-23T00:00:00.000Z')`)
      .run(repositoryId, sourceContext.workspace_id, sourceContext.user_id, sourceContext.user_id)

    const target = createDatabase()
    mergeDatabaseImport(target, context(target), createDatabaseExport(source, sourceContext))
    expect(target.prepare("SELECT is_valid FROM repository_bindings WHERE public_id = 'binding-1'").get()).toEqual({ is_valid: 0 })
    source.close()
    target.close()
  })

  it('rejects malformed packages before writes and rolls back a failed merge', () => {
    const database = createDatabase()
    const packageData: DatabaseTransferPackage = {
      format: 'workpulse-data',
      format_version: 1,
      schema_version: 9,
      exported_at: '2026-08-23T00:00:00.000Z',
      tables: {
        projects: [{ public_id: 'project-1', name: 'invalid missing timestamps' }]
      }
    }

    expect(() => previewDatabaseImport({ format: 'unknown' })).toThrow('IMPORT_INVALID')
    expect(() => mergeDatabaseImport(database, context(database), packageData)).toThrow('IMPORT_INVALID')
    expect(database.prepare('SELECT COUNT(*) AS count FROM projects').get()).toEqual({ count: 0 })
    database.close()
  })

  it('exports only the current workspace and its relationship rows', () => {
    const database = createDatabase()
    const current = context(database)
    const other = createWorkspace(database, 'other')
    addWorkspaceGraph(database, current.workspace_id, current.user_id, 'current')
    addWorkspaceGraph(database, other.workspaceId, other.userId, 'other')

    const exported = createDatabaseExport(database, current)

    expect(exported.tables.workspaces).toHaveLength(1)
    expect(exported.tables.users).toHaveLength(1)
    for (const table of [
      'projects', 'repositories', 'repository_bindings', 'tasks', 'work_logs', 'inbox_items', 'tags',
      'git_commits', 'reports', 'sync_operations', 'work_log_tags', 'task_tags', 'inbox_tags',
      'git_commit_tags', 'report_tags', 'report_projects', 'report_repositories'
    ] as const) {
      expect(exported.tables[table]).toHaveLength(1)
    }
    expect(JSON.stringify(exported)).toContain('-current')
    expect(JSON.stringify(exported)).not.toContain('-other')
    database.close()
  })

  it('round-trips current workspace data without creating workspace or user rows', () => {
    const source = createDatabase()
    const sourceContext = context(source)
    const other = createWorkspace(source, 'other')
    addWorkspaceGraph(source, sourceContext.workspace_id, sourceContext.user_id, 'current')
    addWorkspaceGraph(source, other.workspaceId, other.userId, 'other')
    const packageData = createDatabaseExport(source, sourceContext)

    const target = createDatabase()
    const targetContext = context(target)
    const workspaceCountBefore = (target.prepare('SELECT COUNT(*) AS count FROM workspaces').get() as { count: number }).count
    const userCountBefore = (target.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number }).count

    expect(previewDatabaseImport(packageData).records.workspaces).toBe(1)
    expect(previewDatabaseImport(packageData).records.users).toBe(1)
    const result = mergeDatabaseImport(target, targetContext, packageData)

    expect(result.skipped).toBeGreaterThanOrEqual(2)
    expect(target.prepare('SELECT COUNT(*) AS count FROM workspaces').get()).toEqual({ count: workspaceCountBefore })
    expect(target.prepare('SELECT COUNT(*) AS count FROM users').get()).toEqual({ count: userCountBefore })
    for (const table of [
      'projects', 'repositories', 'repository_bindings', 'tasks', 'work_logs', 'inbox_items', 'tags',
      'git_commits', 'reports', 'sync_operations', 'work_log_tags', 'task_tags', 'inbox_tags',
      'git_commit_tags', 'report_tags', 'report_projects', 'report_repositories'
    ]) {
      expect(target.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()).toEqual({ count: 1 })
    }
    expect(target.prepare('SELECT COUNT(*) AS count FROM projects WHERE public_id = ?').get('project-other')).toEqual({ count: 0 })
    expect(target.prepare('SELECT workspace_id FROM projects WHERE public_id = ?').get('project-current')).toEqual({ workspace_id: targetContext.workspace_id })
    source.close()
    target.close()
  })
})

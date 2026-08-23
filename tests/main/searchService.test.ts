import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'
import { runMigrations } from '../../src/main/database/connection'
import { SearchService } from '../../src/main/services/searchService'

function createSearchDatabase(): Database.Database {
  const database = new Database(':memory:')
  runMigrations(database)
  const now = '2026-08-23T10:00:00.000Z'
  database.exec(`
    INSERT INTO projects (public_id, workspace_id, name, description, color, created_by, updated_by, created_at, updated_at)
      VALUES ('project-1', 1, 'Alpha', '', '#64748b', 1, 1, '${now}', '${now}');
    INSERT INTO repositories (public_id, workspace_id, project_id, name, enabled, created_by, updated_by, created_at, updated_at)
      VALUES ('repo-1', 1, 1, 'alpha-repo', 1, 1, 1, '${now}', '${now}');
    INSERT INTO work_logs (public_id, workspace_id, project_id, repository_id, content, category, created_by, updated_by, created_at, updated_at)
      VALUES ('log-1', 1, 1, 1, 'needle 日志', 'work', 1, 1, '2026-08-23T09:00:00.000Z', '${now}');
    INSERT INTO tasks (public_id, workspace_id, project_id, repository_id, title, description, status, board_column, position, created_by, updated_by, created_at, updated_at)
      VALUES ('task-1', 1, 1, 1, 'needle 任务', '', 'todo', 'todo', 0, 1, 1, '2026-08-23T08:00:00.000Z', '${now}');
    INSERT INTO inbox_items (public_id, workspace_id, project_id, repository_id, content, status, state, include_in_reports, created_by, updated_by, created_at, updated_at)
      VALUES ('inbox-1', 1, 1, 1, 'needle 收件箱', 'inbox', 'unorganized', 1, 1, 1, '2026-08-23T07:00:00.000Z', '${now}');
    INSERT INTO git_commits (public_id, workspace_id, repository_id, commit_hash, author_name, author_email, committed_at, message, branch, files_changed, additions, deletions, created_by, updated_by, created_at, updated_at)
      VALUES ('commit-1', 1, 1, 'hash-1', 'dev', 'dev@example.com', '2026-08-23T06:00:00.000Z', 'needle 提交', 'main', 1, 2, 1, 1, 1, '${now}', '${now}');
    INSERT INTO reports (public_id, workspace_id, type, date_from, date_to, content, generated_at, created_by, updated_by, created_at, updated_at, period_start, period_end_exclusive, timezone, project_scope, repository_scope, source_snapshot, version, status, retry_count)
      VALUES ('report-1', 1, 'weekly', '2026-08-18', '2026-08-24', 'needle 报告', '${now}', 1, 1, '${now}', '${now}', '2026-08-18T00:00:00.000Z', '2026-08-25T00:00:00.000Z', 'UTC', '["project-1"]', '[]', '{}', 1, 'ready', 0);
    INSERT INTO tags (public_id, workspace_id, name, path, created_at, updated_at)
      VALUES ('tag-1', 1, '客户端/导出', '客户端/导出', '${now}', '${now}');
    INSERT INTO tags (public_id, workspace_id, name, path, created_at, updated_at)
      VALUES ('tag-2', 1, 'report-tag', 'report-tag', '${now}', '${now}');
    INSERT INTO work_log_tags (work_log_id, tag_id) VALUES (1, 1);
    INSERT INTO report_tags (report_id, tag_id) VALUES (1, 2);
  `)
  return database
}

describe('SearchService unified search', () => {
  it('returns five entity types with project, tags and time metadata', () => {
    const database = createSearchDatabase()
    const page = new SearchService(database, { workspace_id: 1, user_id: 1 }).search({ text: 'needle', limit: 10, offset: 0 })

    expect(page.total).toBe(5)
    expect(page.items.map((item) => item.source).sort()).toEqual(['git_commit', 'inbox', 'report', 'task', 'work_log'])
    expect(page.items.find((item) => item.source === 'work_log')).toMatchObject({
      public_id: 'log-1', project_id: 'project-1', project_name: 'Alpha', tags: ['客户端/导出']
    })
    expect(page.items.find((item) => item.source === 'report')).toMatchObject({ tags: ['report-tag'] })
    expect(page.items.every((item) => item.time && item.title && item.excerpt)).toBe(true)
    database.close()
  })

  it('does not return soft-deleted rows from another workspace', () => {
    const database = createSearchDatabase()
    database.prepare('UPDATE tasks SET deleted_at = ? WHERE public_id = ?').run('2026-08-23T11:00:00.000Z', 'task-1')
    const page = new SearchService(database, { workspace_id: 1, user_id: 1 }).search({ text: 'needle', limit: 10, offset: 0 })
    expect(page.items.some((item) => item.public_id === 'task-1')).toBe(false)
    database.close()
  })

  it('uses bounded database pagination and preserves the total count', () => {
    const database = createSearchDatabase()
    const prepare = vi.spyOn(database, 'prepare')
    const page = new SearchService(database, { workspace_id: 1, user_id: 1 }).search({ text: 'needle', limit: 1, offset: 1 })

    expect(page.items).toHaveLength(1)
    expect(page.total).toBe(5)
    expect(prepare.mock.calls.some(([sql]) => String(sql).includes('UNION ALL') && String(sql).includes('LIMIT ? OFFSET ?'))).toBe(true)
    expect(prepare.mock.calls.some(([sql]) => String(sql).includes('COUNT(*)'))).toBe(true)
    database.close()
  })
})

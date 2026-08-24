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
    INSERT INTO report_projects (report_id, project_id) VALUES (1, 1);
    INSERT INTO report_repositories (report_id, repository_id) VALUES (1, 1);
  `)
  return database
}

function addFilteredFixtures(database: Database.Database): void {
  const now = '2026-08-23T10:00:00.000Z'
  database.exec(`
    INSERT INTO projects (public_id, workspace_id, name, description, color, created_by, updated_by, created_at, updated_at)
      VALUES ('project-2', 1, 'Beta', '', '#64748b', 1, 1, '${now}', '${now}');
    INSERT INTO repositories (public_id, workspace_id, project_id, name, enabled, created_by, updated_by, created_at, updated_at)
      VALUES ('repo-2', 1, (SELECT id FROM projects WHERE public_id = 'project-2'), 'beta-repo', 1, 1, 1, '${now}', '${now}');
    INSERT INTO work_logs (public_id, workspace_id, project_id, repository_id, content, category, created_by, updated_by, created_at, updated_at)
      VALUES ('log-2', 1, (SELECT id FROM projects WHERE public_id = 'project-2'), (SELECT id FROM repositories WHERE public_id = 'repo-2'), 'needle beta log', 'work', 1, 1, '2026-08-23T05:00:00.000Z', '${now}');
    INSERT INTO tasks (public_id, workspace_id, project_id, repository_id, title, description, status, board_column, position, created_by, updated_by, created_at, updated_at)
      VALUES ('task-2', 1, (SELECT id FROM projects WHERE public_id = 'project-2'), (SELECT id FROM repositories WHERE public_id = 'repo-2'), 'needle beta task', '', 'todo', 'todo', 1, 1, 1, '2026-08-23T04:00:00.000Z', '${now}');
    INSERT INTO inbox_items (public_id, workspace_id, project_id, repository_id, content, status, state, include_in_reports, created_by, updated_by, created_at, updated_at)
      VALUES ('inbox-2', 1, (SELECT id FROM projects WHERE public_id = 'project-2'), (SELECT id FROM repositories WHERE public_id = 'repo-2'), 'needle beta inbox', 'inbox', 'confirmed', 1, 1, 1, '2026-08-23T03:00:00.000Z', '${now}');
    INSERT INTO git_commits (public_id, workspace_id, repository_id, commit_hash, author_name, author_email, committed_at, message, branch, files_changed, additions, deletions, created_by, updated_by, created_at, updated_at)
      VALUES ('commit-2', 1, (SELECT id FROM repositories WHERE public_id = 'repo-2'), 'hash-2', 'dev', 'dev@example.com', '2026-08-23T02:00:00.000Z', 'needle beta commit', 'main', 1, 2, 1, 1, 1, '${now}', '${now}');
    INSERT INTO reports (public_id, workspace_id, type, date_from, date_to, content, generated_at, created_by, updated_by, created_at, updated_at, period_start, period_end_exclusive, timezone, project_scope, repository_scope, source_snapshot, version, status, retry_count)
      VALUES ('report-2', 1, 'weekly', '2026-08-18', '2026-08-24', 'needle beta report', '${now}', 1, 1, '${now}', '${now}', '2026-08-18T00:00:00.000Z', '2026-08-25T00:00:00.000Z', 'UTC', '["project-1", "project-2"]', '["repo-1", "repo-2"]', '{}', 1, 'ready', 0);
    INSERT INTO report_projects (report_id, project_id) SELECT id, (SELECT id FROM projects WHERE public_id = 'project-1') FROM reports WHERE public_id = 'report-2';
    INSERT INTO report_projects (report_id, project_id) SELECT id, (SELECT id FROM projects WHERE public_id = 'project-2') FROM reports WHERE public_id = 'report-2';
    INSERT INTO report_repositories (report_id, repository_id) SELECT id, (SELECT id FROM repositories WHERE public_id = 'repo-1') FROM reports WHERE public_id = 'report-2';
    INSERT INTO report_repositories (report_id, repository_id) SELECT id, (SELECT id FROM repositories WHERE public_id = 'repo-2') FROM reports WHERE public_id = 'report-2';
    INSERT INTO tags (public_id, workspace_id, name, path, created_at, updated_at)
      VALUES ('tag-filter', 1, 'filter-tag', 'filter-tag', '${now}', '${now}');
    INSERT INTO work_log_tags (work_log_id, tag_id) SELECT id, (SELECT id FROM tags WHERE public_id = 'tag-filter') FROM work_logs WHERE public_id = 'log-2';
    INSERT INTO task_tags (task_id, tag_id) SELECT id, (SELECT id FROM tags WHERE public_id = 'tag-filter') FROM tasks WHERE public_id = 'task-2';
    INSERT INTO inbox_tags (inbox_item_id, tag_id) SELECT id, (SELECT id FROM tags WHERE public_id = 'tag-filter') FROM inbox_items WHERE public_id = 'inbox-2';
    INSERT INTO git_commit_tags (git_commit_id, tag_id) SELECT id, (SELECT id FROM tags WHERE public_id = 'tag-filter') FROM git_commits WHERE public_id = 'commit-2';
    INSERT INTO report_tags (report_id, tag_id) SELECT id, (SELECT id FROM tags WHERE public_id = 'tag-filter') FROM reports WHERE public_id = 'report-2';
  `)
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

  it('uses FTS5 for text candidates and falls back for Chinese substrings', () => {
    const database = createSearchDatabase()
    const prepare = vi.spyOn(database, 'prepare')
    const service = new SearchService(database, { workspace_id: 1, user_id: 1 })

    const page = service.search({ text: '志', limit: 20 })

    expect(page.items.some((item) => item.public_id === 'log-1')).toBe(true)
    expect(prepare.mock.calls.some(([sql]) => String(sql).includes('content_search MATCH'))).toBe(true)
    expect(() => service.search({ text: 'alpha "beta', limit: 20 })).not.toThrow()
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

  it('applies project, repository, tag and inbox state filters to each source', () => {
    const database = createSearchDatabase()
    addFilteredFixtures(database)
    const service = new SearchService(database, { workspace_id: 1, user_id: 1 })

    expect(service.search({ text: 'needle', project_id: 'project-2', limit: 20 }).items.map((item) => item.public_id).sort()).toEqual(['commit-2', 'inbox-2', 'log-2', 'report-2', 'task-2'])
    expect(service.search({ text: 'needle', repository_id: 'repo-2', limit: 20 }).items.map((item) => item.public_id).sort()).toEqual(['commit-2', 'inbox-2', 'log-2', 'report-2', 'task-2'])
    expect(service.search({ text: 'needle', tag_names: ['filter-tag'], limit: 20 }).items.map((item) => item.public_id).sort()).toEqual(['commit-2', 'inbox-2', 'log-2', 'report-2', 'task-2'])
    const stateItems = service.search({ text: 'needle', state: 'confirmed', limit: 20 }).items
    expect(stateItems).toEqual(expect.arrayContaining([expect.objectContaining({ public_id: 'inbox-2', source: 'inbox' })]))
    expect(stateItems.some((item) => item.public_id === 'inbox-1')).toBe(false)
    expect(stateItems.some((item) => item.source === 'work_log')).toBe(true)
    database.close()
  })

  it('returns each multi-project and multi-repository report once with aggregate ownership', () => {
    const database = createSearchDatabase()
    addFilteredFixtures(database)
    const page = new SearchService(database, { workspace_id: 1, user_id: 1 }).search({ text: 'beta report', limit: 20 })
    const reports = page.items.filter((item) => item.source === 'report')
    expect(reports).toHaveLength(1)
    expect(page.total).toBe(1)
    expect(reports[0]).toMatchObject({
      public_id: 'report-2',
      project_id: 'project-1,project-2',
      project_name: 'Alpha,Beta',
      repository_id: 'repo-1,repo-2',
      repository_name: 'alpha-repo,beta-repo',
      tags: ['filter-tag']
    })
    database.close()
  })

  it('does not use another workspace when applying a tag filter', () => {
    const database = createSearchDatabase()
    const now = '2026-08-23T10:00:00.000Z'
    database.exec(`
      INSERT INTO workspaces (public_id, name, created_at, updated_at) VALUES ('workspace-2', 'Other', '${now}', '${now}');
      INSERT INTO users (public_id, workspace_id, name, created_at, updated_at) VALUES ('user-2', 2, 'Other', '${now}', '${now}');
      INSERT INTO tags (public_id, workspace_id, name, path, created_at, updated_at) VALUES ('tag-other', 2, 'filter-tag', 'filter-tag', '${now}', '${now}');
      INSERT INTO work_logs (public_id, workspace_id, content, category, created_by, updated_by, created_at, updated_at) VALUES ('log-other', 2, 'needle other', 'work', 2, 2, '${now}', '${now}');
      INSERT INTO work_log_tags (work_log_id, tag_id) SELECT id, (SELECT id FROM tags WHERE public_id = 'tag-other') FROM work_logs WHERE public_id = 'log-other';
    `)
    const page = new SearchService(database, { workspace_id: 1, user_id: 1 }).search({ text: 'needle', tag_names: ['filter-tag'], limit: 20 })
    expect(page.items).toEqual([])
    database.close()
  })
})

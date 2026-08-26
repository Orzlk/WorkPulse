import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { getDatabaseVersion, runMigrations } from '../../src/main/database/connection'

const NOW = '2026-08-24T10:00:00.000Z'

function createDatabaseWithFixtures(): Database.Database {
  const database = new Database(':memory:')
  runMigrations(database)
  database.exec(`
    INSERT INTO work_logs (
      public_id, workspace_id, content, category, created_by, updated_by, created_at, updated_at
    ) VALUES ('log-1', 1, 'work log phrase', 'work', 1, 1, '${NOW}', '${NOW}');
    INSERT INTO tasks (
      public_id, workspace_id, title, description, status, board_column, position,
      created_by, updated_by, created_at, updated_at
    ) VALUES ('task-1', 1, 'task phrase', 'task description', 'todo', 'todo', 0, 1, 1, '${NOW}', '${NOW}');
    INSERT INTO inbox_items (
      public_id, workspace_id, content, status, state, include_in_reports,
      created_by, updated_by, created_at, updated_at
    ) VALUES ('inbox-1', 1, 'inbox phrase', 'inbox', 'unorganized', 1, 1, 1, '${NOW}', '${NOW}');
    INSERT INTO repositories (
      public_id, workspace_id, name, enabled, created_by, updated_by, created_at, updated_at
    ) VALUES ('repo-1', 1, 'repository', 1, 1, 1, '${NOW}', '${NOW}');
    INSERT INTO git_commits (
      public_id, workspace_id, repository_id, commit_hash, author_name, author_email,
      committed_at, message, branch, files_changed, additions, deletions,
      created_by, updated_by, created_at, updated_at
    ) VALUES ('commit-1', 1, 1, 'hash-1', 'dev', 'dev@example.com', '${NOW}', 'commit phrase', 'main', 1, 1, 0, 1, 1, '${NOW}', '${NOW}');
    INSERT INTO reports (
      public_id, workspace_id, type, date_from, date_to, content, generated_at,
      created_by, updated_by, created_at, updated_at, period_start,
      period_end_exclusive, timezone, project_scope, repository_scope,
      source_snapshot, version, status, retry_count
    ) VALUES ('report-1', 1, 'weekly', '2026-08-19', '2026-08-25', 'report phrase', '${NOW}',
      1, 1, '${NOW}', '${NOW}', '2026-08-19T00:00:00.000Z',
      '2026-08-26T00:00:00.000Z', 'UTC', '[]', '[]', '{}', 1, 'ready', 0);
  `)
  return database
}

function searchIndexedTypes(database: Database.Database): string[] {
  return (database.prepare(`
    SELECT DISTINCT entity_type FROM content_search ORDER BY entity_type
  `).all() as Array<{ entity_type: string }>).map((row) => row.entity_type)
}

function matchIds(database: Database.Database, entityType: string, text: string): string[] {
  return (database.prepare(`
    SELECT entity_id
    FROM content_search
    WHERE content_search MATCH ? AND entity_type = ?
    ORDER BY entity_id
  `).all(text, entityType) as Array<{ entity_id: string }>).map((row) => row.entity_id)
}

describe('content search index', () => {
  it('backfills and maintains FTS documents for all searchable entities', () => {
    const database = createDatabaseWithFixtures()

    expect(getDatabaseVersion(database)).toBe(1)
    expect(searchIndexedTypes(database)).toEqual(['git_commit', 'inbox_item', 'report', 'task', 'work_log'])

    database.prepare('UPDATE work_logs SET content = ? WHERE public_id = ?').run('updated phrase', 'log-1')
    expect(matchIds(database, 'work_log', 'updated')).toEqual(['1'])

    database.prepare('UPDATE work_logs SET deleted_at = ? WHERE public_id = ?').run(NOW, 'log-1')
    expect(matchIds(database, 'work_log', 'updated')).toEqual([])
    database.close()
  })

  it('creates insert, update and delete triggers for every searchable entity', () => {
    const database = createDatabaseWithFixtures()
    const triggers = database.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'trigger' AND name LIKE 'content_search_%'
      ORDER BY name
    `).all() as Array<{ name: string }>

    expect(triggers).toHaveLength(15)
    database.close()
  })
})

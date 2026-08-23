import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { backupDatabase, getDatabaseVersion, openDatabase, runMigrations } from '../../src/main/database/connection'

const temporaryDirectories: string[] = []

function createTemporaryPath(name: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'workpulse-migrations-'))
  temporaryDirectories.push(directory)
  return join(directory, name)
}

function openMigratedDatabase(): Database.Database {
  const database = openDatabase(createTemporaryPath('workpulse.db'))
  runMigrations(database)
  return database
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    try {
      rmSync(directory, { force: true, recursive: true })
    } catch {
      // Windows can retain a short-lived SQLite file handle after a failed assertion.
    }
  }
})

describe('SQLite migrations', () => {
  it('creates the complete local-first schema for a new database', () => {
    const database = openMigratedDatabase()

    const tables = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as Array<{ name: string }>
    const tableNames = tables.map((table) => table.name)

    expect(getDatabaseVersion(database)).toBe(6)
    expect(tableNames).toEqual(expect.arrayContaining([
      'schema_migrations',
      'workspaces',
      'users',
      'projects',
      'inbox_items',
      'repositories',
      'repository_bindings',
      'git_commits',
      'tags',
      'work_log_tags',
      'task_tags',
      'inbox_tags',
      'git_commit_tags',
      'report_tags',
      'reports',
      'sync_operations'
    ]))

    expect(database.prepare('SELECT COUNT(*) AS count FROM workspaces').get()).toEqual({ count: 1 })
    expect(database.prepare('SELECT COUNT(*) AS count FROM users').get()).toEqual({ count: 1 })
    database.close()
  })

  it('registers an existing legacy schema as the baseline without losing rows', () => {
    const databasePath = createTemporaryPath('legacy.db')
    const legacyDatabase = new Database(databasePath)
    legacyDatabase.exec(`
      CREATE TABLE tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT DEFAULT '',
        status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo', 'in_progress', 'done')),
        board_column TEXT NOT NULL DEFAULT 'todo',
        position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      );
      CREATE TABLE work_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT NOT NULL,
        category TEXT DEFAULT '',
        created_at TEXT NOT NULL,
        task_id INTEGER
      );
      CREATE TABLE reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        date_from TEXT NOT NULL,
        date_to TEXT NOT NULL,
        content TEXT NOT NULL,
        generated_at TEXT NOT NULL
      );
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `)
    legacyDatabase
      .prepare('INSERT INTO tasks (title, created_at, updated_at) VALUES (?, ?, ?)')
      .run('保留的旧任务', '2026-08-01 09:00:00', '2026-08-01 09:00:00')
    legacyDatabase
      .prepare('INSERT INTO work_logs (content, created_at, task_id) VALUES (?, ?, ?)')
      .run('保留的旧日志', '2026-08-01 09:30:00', 1)
    legacyDatabase.close()

    const database = openDatabase(databasePath)
    runMigrations(database)

    expect(getDatabaseVersion(database)).toBe(6)
    expect(database.prepare('SELECT id, title FROM tasks').all()).toEqual([{ id: 1, title: '保留的旧任务' }])
    expect(database.prepare('SELECT id, content, task_id FROM work_logs').all()).toEqual([
      { id: 1, content: '保留的旧日志', task_id: 1 }
    ])
    expect(database.prepare('SELECT public_id, workspace_id, created_by, updated_by FROM tasks WHERE id = 1').get())
      .toEqual(expect.objectContaining({
        public_id: expect.any(String),
        workspace_id: expect.any(Number),
        created_by: expect.any(Number),
        updated_by: expect.any(Number)
      }))
    expect(database.prepare("SELECT value FROM settings WHERE key = 'migration.timezone'").get())
      .toEqual({ value: expect.any(String) })
    database.close()
  })

  it('does not change rows or migration records when run more than once', () => {
    const database = openMigratedDatabase()
    database.prepare('INSERT INTO tasks (title) VALUES (?)').run('不应重复的数据')
    const before = database.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get()

    runMigrations(database)

    expect(database.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get()).toEqual(before)
    expect(database.prepare('SELECT title FROM tasks').all()).toEqual([{ title: '不应重复的数据' }])
    database.close()
  })

  it('rolls back a failed migration before recording its version', () => {
    const database = openDatabase(createTemporaryPath('rollback.db'))
    database.exec(`
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE VIEW work_logs AS SELECT 1 AS id;
    `)

    expect(() => runMigrations(database)).toThrow()
    expect(getDatabaseVersion(database)).toBe(1)
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'workspaces'").get())
      .toBeUndefined()
    database.close()
  })
})

describe('SQLite backup', () => {
  it('creates an integrity-checked backup from a WAL database', async () => {
    const source = openMigratedDatabase()
    source.prepare('INSERT INTO work_logs (content) VALUES (?)').run('WAL 中的记录')
    const backupPath = createTemporaryPath('backups/workpulse.db')

    await backupDatabase(source, backupPath)

    expect(existsSync(backupPath)).toBe(true)
    const backup = new Database(backupPath, { readonly: true })
    expect(backup.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }])
    expect(backup.prepare('SELECT content FROM work_logs').all()).toEqual([{ content: 'WAL 中的记录' }])
    backup.close()
    source.close()
  })
})

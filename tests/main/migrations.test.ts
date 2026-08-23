import Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { backupDatabase, getDatabaseVersion, initializeDatabase, openDatabase, runMigrations } from '../../src/main/database/connection'

let electronUserDataPath = ''

vi.mock('electron', () => ({
  app: {
    getPath: () => electronUserDataPath
  }
}))

import {
  addTask,
  addWorkLog,
  getDatabase,
  initDatabase,
  reorderTasks,
  saveReport,
  setSetting
} from '../../src/main/db'

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

    expect(getDatabaseVersion(database)).toBe(7)
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
    legacyDatabase
      .prepare('INSERT INTO reports (type, date_from, date_to, content, generated_at) VALUES (?, ?, ?, ?, ?)')
      .run('monthly', '2026-08-01', '2026-08-31', '保留的旧报告', '2026-08-01T10:00:00-07:00')
    legacyDatabase
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
      .run('保留的旧设置', '旧值')
    legacyDatabase.close()

    const database = openDatabase(databasePath)
    runMigrations(database, { now: () => new Date('2026-08-23T12:34:56.000Z') })

    expect(getDatabaseVersion(database)).toBe(7)
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
    const report = database.prepare('SELECT generated_at, created_at, updated_at, public_id, workspace_id, created_by, updated_by FROM reports WHERE id = 1').get() as Record<string, unknown>
    const setting = database.prepare('SELECT created_at, updated_at, public_id, workspace_id, created_by, updated_by FROM settings WHERE key = ?').get('保留的旧设置') as Record<string, unknown>
    for (const row of [report, setting]) {
      expect(row.public_id).toEqual(expect.any(String))
      expect(row.workspace_id).toEqual(expect.any(Number))
      expect(row.created_by).toEqual(expect.any(Number))
      expect(row.updated_by).toEqual(expect.any(Number))
      expect(row.created_at).toEqual(expect.stringMatching(/Z$/))
      expect(row.updated_at).toEqual(expect.stringMatching(/Z$/))
      expect(Number.isNaN(Date.parse(row.created_at as string))).toBe(false)
      expect(Number.isNaN(Date.parse(row.updated_at as string))).toBe(false)
    }
    expect(report.created_at).toBe('2026-08-01T17:00:00.000Z')
    expect(report.updated_at).toBe('2026-08-01T17:00:00.000Z')
    expect(report.generated_at).toBe('2026-08-01T17:00:00.000Z')
    expect(setting.created_at).toBe('2026-08-23T12:34:56.000Z')
    expect(setting.updated_at).toBe('2026-08-23T12:34:56.000Z')
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

  it('cleans the temporary backup when backup integrity validation fails', async () => {
    const backupDirectory = createTemporaryPath('invalid-backup')
    const targetPath = join(backupDirectory, 'workpulse.db')
    const invalidSource = {
      backup: async (temporaryPath: string) => {
        writeFileSync(temporaryPath, 'not a sqlite database')
      }
    } as unknown as Database.Database

    await expect(backupDatabase(invalidSource, targetPath)).rejects.toThrow()

    expect(existsSync(targetPath)).toBe(false)
    expect(readdirSync(backupDirectory).filter((name) => name.includes('.workpulse.db.tmp-'))).toEqual([])
  })

  it('does not migrate when the startup backup fails', async () => {
    const databasePath = createTemporaryPath('startup-failure/workpulse.db')
    const source = openDatabase(databasePath)
    source.close()

    let migrateCalled = false
    await expect(initializeDatabase(
      databasePath,
      async () => {
        throw new Error('backup failed')
      },
      () => {
        migrateCalled = true
      }
    )).rejects.toThrow('backup failed')

    const reopened = new Database(databasePath)
    expect(migrateCalled).toBe(false)
    expect(getDatabaseVersion(reopened)).toBe(0)
    reopened.close()
  })
})

describe('legacy CRUD identity defaults', () => {
  it('fills sync identity and UTC audit fields when old CRUD creates rows after migration', async () => {
    electronUserDataPath = createTemporaryPath('crud-user-data')
    await initDatabase()

    const log = addWorkLog('新日志')
    const task = addTask('新任务')
    const report = saveReport('monthly', '2026-08-01', '2026-08-31', '新报告')
    setSetting('新设置', '新值')

    const database = getDatabase()
    const rows = [
      database.prepare('SELECT public_id, workspace_id, created_by, updated_by, created_at, updated_at FROM work_logs WHERE id = ?').get(log.id),
      database.prepare('SELECT public_id, workspace_id, created_by, updated_by, created_at, updated_at FROM tasks WHERE id = ?').get(task.id),
      database.prepare('SELECT public_id, workspace_id, created_by, updated_by, created_at, updated_at FROM reports WHERE id = ?').get(report.id),
      database.prepare('SELECT public_id, workspace_id, created_by, updated_by, created_at, updated_at FROM settings WHERE key = ?').get('新设置')
    ] as Array<Record<string, unknown>>

    for (const row of rows) {
      expect(row.public_id).toEqual(expect.any(String))
      expect(row.workspace_id).toEqual(expect.any(Number))
      expect(row.created_by).toEqual(expect.any(Number))
      expect(row.updated_by).toEqual(expect.any(Number))
      expect(row.created_at).toEqual(expect.stringMatching(/Z$/))
      expect(row.updated_at).toEqual(expect.stringMatching(/Z$/))
      expect(Number.isNaN(Date.parse(row.created_at as string))).toBe(false)
      expect(Number.isNaN(Date.parse(row.updated_at as string))).toBe(false)
    }
    database.close()
  })

  it('writes UTC audit fields and updated_by when tasks are reordered and completed', async () => {
    electronUserDataPath = createTemporaryPath('reorder-user-data')
    await initDatabase()

    const task = addTask('待完成任务')
    const database = getDatabase()
    database.prepare('UPDATE tasks SET updated_by = ? WHERE id = ?').run(999, task.id)

    reorderTasks([task.id], 'done')

    const row = database.prepare('SELECT status, updated_at, updated_by, completed_at FROM tasks WHERE id = ?').get(task.id) as {
      status: string
      updated_at: string
      updated_by: number
      completed_at: string
    }
    const localUser = database.prepare('SELECT id FROM users ORDER BY id LIMIT 1').get() as { id: number }
    expect(row.status).toBe('done')
    expect(row.updated_by).toBe(localUser.id)
    expect(row.updated_by).not.toBe(999)
    expect(row.updated_at).toEqual(expect.stringMatching(/Z$/))
    expect(row.completed_at).toBe(row.updated_at)
    database.close()
  })

  it('creates a fresh migration backup even when the daily backup file already exists', async () => {
    electronUserDataPath = createTemporaryPath('backup-user-data')
    await initDatabase()
    getDatabase().close()

    const backupDirectory = join(electronUserDataPath, 'backups')
    mkdirSync(backupDirectory, { recursive: true })
    writeFileSync(join(backupDirectory, 'workpulse-2026-08-23.db'), 'old daily backup')

    await initDatabase()

    const backups = readdirSync(backupDirectory).filter((name) => name.startsWith('workpulse-'))
    expect(backups).toHaveLength(2)
    expect(backups.some((name) => name.includes('-v7-') && name.includes('T'))).toBe(true)
    getDatabase().close()
  })
})

import { randomUUID } from 'node:crypto'

import type Database from 'better-sqlite3'
import { fromZonedTime } from 'date-fns-tz'

import type { MigrationContext, SchemaMigration } from './types'

const CORE_TABLES = ['work_logs', 'tasks', 'reports', 'settings'] as const
const UTC_NOW_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')"

function tableExists(database: Database.Database, tableName: string): boolean {
  return Boolean(
    database
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(tableName)
  )
}

function tableColumns(database: Database.Database, tableName: string): Set<string> {
  if (!tableExists(database, tableName)) return new Set()
  const columns = database.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>
  return new Set(columns.map((column) => column.name))
}

function addColumnIfMissing(
  database: Database.Database,
  tableName: string,
  columnName: string,
  definition: string
): void {
  if (!tableColumns(database, tableName).has(columnName)) {
    database.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`)
  }
}

function createCoreSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS work_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT NOT NULL,
      category TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (${UTC_NOW_SQL}),
      task_id INTEGER,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo', 'in_progress', 'done', 'draft')),
      board_column TEXT NOT NULL DEFAULT 'todo',
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (${UTC_NOW_SQL}),
      updated_at TEXT NOT NULL DEFAULT (${UTC_NOW_SQL}),
      completed_at TEXT,
      due_date TEXT DEFAULT NULL
    );

    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL CHECK(type IN ('weekly', 'monthly', 'quarterly', 'custom')),
      date_from TEXT NOT NULL,
      date_to TEXT NOT NULL,
      content TEXT NOT NULL,
      generated_at TEXT NOT NULL DEFAULT (${UTC_NOW_SQL})
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_work_logs_created_at ON work_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_reports_dates ON reports(date_from, date_to);
  `)
}

function taskSchemaIncludesDraft(database: Database.Database): boolean {
  const row = database
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'tasks'")
    .get() as { sql?: string } | undefined
  return row?.sql?.includes("'draft'") ?? false
}

function sourceColumn(columns: Set<string>, columnName: string, fallback: string): string {
  return columns.has(columnName) ? columnName : fallback
}

function rebuildLegacyTasks(database: Database.Database): void {
  if (!tableExists(database, 'tasks') || taskSchemaIncludesDraft(database)) return

  const columns = tableColumns(database, 'tasks')
  database.exec(`
    CREATE TABLE tasks_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo', 'in_progress', 'done', 'draft')),
      board_column TEXT NOT NULL DEFAULT 'todo',
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      due_date TEXT DEFAULT NULL
    );
    INSERT INTO tasks_new (
      id, title, description, status, board_column, position,
      created_at, updated_at, completed_at, due_date
    )
    SELECT
      ${sourceColumn(columns, 'id', 'NULL')},
      ${sourceColumn(columns, 'title', "''")},
      ${sourceColumn(columns, 'description', "''")},
      ${sourceColumn(columns, 'status', "'todo'")},
      ${sourceColumn(columns, 'board_column', "'todo'")},
      ${sourceColumn(columns, 'position', '0')},
      ${sourceColumn(columns, 'created_at', UTC_NOW_SQL)},
      ${sourceColumn(columns, 'updated_at', 'created_at')},
      ${sourceColumn(columns, 'completed_at', 'NULL')},
      ${sourceColumn(columns, 'due_date', 'NULL')}
    FROM tasks;
    DROP TABLE tasks;
    ALTER TABLE tasks_new RENAME TO tasks;
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
  `)
}

function createDefaultWorkspace(database: Database.Database): { workspaceId: number; userId: number } {
  let workspace = database.prepare('SELECT id FROM workspaces ORDER BY id LIMIT 1').get() as { id: number } | undefined
  if (!workspace) {
    const result = database
      .prepare(`INSERT INTO workspaces (public_id, name, created_at, updated_at) VALUES (?, ?, ${UTC_NOW_SQL}, ${UTC_NOW_SQL})`)
      .run(randomUUID(), '个人空间')
    workspace = { id: Number(result.lastInsertRowid) }
  }

  let user = database
    .prepare('SELECT id FROM users WHERE workspace_id = ? ORDER BY id LIMIT 1')
    .get(workspace.id) as { id: number } | undefined
  if (!user) {
    const result = database
      .prepare(`INSERT INTO users (public_id, workspace_id, name, created_at, updated_at) VALUES (?, ?, ?, ${UTC_NOW_SQL}, ${UTC_NOW_SQL})`)
      .run(randomUUID(), workspace.id, '本地用户')
    user = { id: Number(result.lastInsertRowid) }
  }

  return { workspaceId: workspace.id, userId: user.id }
}

function addIdentityColumns(
  database: Database.Database,
  tableName: string,
  workspaceId: number,
  userId: number,
  migrationTimestamp: string
): void {
  const originalColumns = tableColumns(database, tableName)
  addColumnIfMissing(database, tableName, 'public_id', 'TEXT')
  addColumnIfMissing(database, tableName, 'workspace_id', 'INTEGER')
  addColumnIfMissing(database, tableName, 'created_by', 'INTEGER')
  addColumnIfMissing(database, tableName, 'updated_by', 'INTEGER')
  addColumnIfMissing(database, tableName, 'created_at', 'TEXT')
  addColumnIfMissing(database, tableName, 'updated_at', 'TEXT')
  addColumnIfMissing(database, tableName, 'deleted_at', 'TEXT')

  const rows = database
    .prepare(`SELECT rowid AS migration_rowid FROM ${tableName} WHERE public_id IS NULL OR public_id = ''`)
    .all() as Array<{ migration_rowid: number }>
  const updatePublicId = database.prepare(`UPDATE ${tableName} SET public_id = ? WHERE rowid = ?`)
  for (const row of rows) {
    updatePublicId.run(randomUUID(), row.migration_rowid)
  }

  const legacyTimeColumn = tableName === 'reports'
    ? originalColumns.has('generated_at') ? 'generated_at' : undefined
    : originalColumns.has('created_at') ? 'created_at' : undefined
  const timeSource = legacyTimeColumn ?? '?'
  const timeParameters = legacyTimeColumn ? [] : [migrationTimestamp]
  database
    .prepare(`UPDATE ${tableName} SET workspace_id = ?, created_by = ?, updated_by = ?, created_at = COALESCE(created_at, ${timeSource}), updated_at = COALESCE(updated_at, ${timeSource}) WHERE workspace_id IS NULL OR created_by IS NULL OR updated_by IS NULL OR created_at IS NULL OR updated_at IS NULL`)
    .run(workspaceId, userId, userId, ...timeParameters, ...timeParameters)
  database.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_${tableName}_public_id ON ${tableName}(public_id)`)
}

function convertTimestamp(value: string, timeZone: string): string {
  if (/Z$|[+-]\d{2}:?\d{2}$/.test(value)) {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? value : date.toISOString()
  }

  if (!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(value)) {
    return value
  }

  try {
    return fromZonedTime(value.replace(' ', 'T'), timeZone).toISOString()
  } catch {
    return value
  }
}

function convertLegacyTimestamps(database: Database.Database, timeZone: string): void {
  const timestampColumns: Array<[string, string[]]> = [
    ['work_logs', ['created_at', 'updated_at', 'deleted_at']],
    ['tasks', ['created_at', 'updated_at', 'completed_at', 'deleted_at']],
    ['reports', ['generated_at', 'created_at', 'updated_at', 'deleted_at']],
    ['settings', ['created_at', 'updated_at', 'deleted_at']]
  ]

  for (const [tableName, columns] of timestampColumns) {
    const presentColumns = columns.filter((column) => tableColumns(database, tableName).has(column))
    for (const column of presentColumns) {
      const rows = database
        .prepare(`SELECT rowid AS migration_rowid, ${column} AS value FROM ${tableName} WHERE ${column} IS NOT NULL`)
        .all() as Array<{ migration_rowid: number; value: string }>
      const update = database.prepare(`UPDATE ${tableName} SET ${column} = ? WHERE rowid = ?`)
      for (const row of rows) {
        const converted = convertTimestamp(row.value, timeZone)
        if (converted !== row.value) update.run(converted, row.migration_rowid)
      }
    }
  }
}

const migrations: SchemaMigration[] = [
  {
    version: 1,
    name: '001_core_schema',
    up: createCoreSchema
  },
  {
    version: 2,
    name: '002_workspace_identity',
    up: (database, context: MigrationContext) => {
      rebuildLegacyTasks(database)
      database.exec(`
        CREATE TABLE IF NOT EXISTS workspaces (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          public_id TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          deleted_at TEXT
        );
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          public_id TEXT NOT NULL UNIQUE,
          workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
          name TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          deleted_at TEXT
        );
      `)
      const { workspaceId, userId } = createDefaultWorkspace(database)
      const migrationTimestamp = context.now().toISOString()
      for (const tableName of CORE_TABLES) {
        addIdentityColumns(database, tableName, workspaceId, userId, migrationTimestamp)
      }

      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
      convertLegacyTimestamps(database, timeZone)
      database
        .prepare(`INSERT INTO settings (key, value, public_id, workspace_id, created_by, updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ${UTC_NOW_SQL}, ${UTC_NOW_SQL}) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
        .run('migration.timezone', timeZone, randomUUID(), workspaceId, userId, userId)
    }
  },
  {
    version: 3,
    name: '003_projects_inbox_repositories',
    up: (database) => {
      database.exec(`
        CREATE TABLE IF NOT EXISTS projects (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          public_id TEXT NOT NULL UNIQUE,
          workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          created_by INTEGER REFERENCES users(id),
          updated_by INTEGER REFERENCES users(id),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          deleted_at TEXT
        );
        CREATE TABLE IF NOT EXISTS repositories (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          public_id TEXT NOT NULL UNIQUE,
          workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
          name TEXT NOT NULL,
          remote_url TEXT,
          created_by INTEGER REFERENCES users(id),
          updated_by INTEGER REFERENCES users(id),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          deleted_at TEXT
        );
        CREATE TABLE IF NOT EXISTS repository_bindings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          public_id TEXT NOT NULL UNIQUE,
          repository_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
          local_path TEXT NOT NULL,
          branch TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          deleted_at TEXT,
          UNIQUE(repository_id, local_path)
        );
        CREATE TABLE IF NOT EXISTS inbox_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          public_id TEXT NOT NULL UNIQUE,
          workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
          project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
          repository_id INTEGER REFERENCES repositories(id) ON DELETE SET NULL,
          content TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'inbox' CHECK(status IN ('inbox', 'organized', 'archived')),
          created_by INTEGER REFERENCES users(id),
          updated_by INTEGER REFERENCES users(id),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          deleted_at TEXT
        );
        CREATE TABLE IF NOT EXISTS git_commits (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          public_id TEXT NOT NULL UNIQUE,
          workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
          repository_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
          commit_hash TEXT NOT NULL,
          author_name TEXT NOT NULL DEFAULT '',
          author_email TEXT NOT NULL DEFAULT '',
          committed_at TEXT NOT NULL,
          message TEXT NOT NULL,
          branch TEXT,
          files_changed INTEGER NOT NULL DEFAULT 0,
          additions INTEGER NOT NULL DEFAULT 0,
          deletions INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(repository_id, commit_hash)
        );
      `)
      addColumnIfMissing(database, 'work_logs', 'project_id', 'INTEGER REFERENCES projects(id) ON DELETE SET NULL')
      addColumnIfMissing(database, 'work_logs', 'repository_id', 'INTEGER REFERENCES repositories(id) ON DELETE SET NULL')
      addColumnIfMissing(database, 'tasks', 'project_id', 'INTEGER REFERENCES projects(id) ON DELETE SET NULL')
      addColumnIfMissing(database, 'tasks', 'repository_id', 'INTEGER REFERENCES repositories(id) ON DELETE SET NULL')
    }
  },
  {
    version: 4,
    name: '004_tags_search',
    up: (database) => {
      database.exec(`
        CREATE TABLE IF NOT EXISTS tags (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          public_id TEXT NOT NULL UNIQUE,
          workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
          name TEXT NOT NULL,
          path TEXT NOT NULL,
          parent_id INTEGER REFERENCES tags(id) ON DELETE SET NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          deleted_at TEXT,
          UNIQUE(workspace_id, path)
        );
        CREATE TABLE IF NOT EXISTS work_log_tags (
          work_log_id INTEGER NOT NULL REFERENCES work_logs(id) ON DELETE CASCADE,
          tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
          PRIMARY KEY(work_log_id, tag_id)
        );
        CREATE TABLE IF NOT EXISTS task_tags (
          task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
          PRIMARY KEY(task_id, tag_id)
        );
        CREATE TABLE IF NOT EXISTS inbox_tags (
          inbox_item_id INTEGER NOT NULL REFERENCES inbox_items(id) ON DELETE CASCADE,
          tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
          PRIMARY KEY(inbox_item_id, tag_id)
        );
        CREATE TABLE IF NOT EXISTS git_commit_tags (
          git_commit_id INTEGER NOT NULL REFERENCES git_commits(id) ON DELETE CASCADE,
          tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
          PRIMARY KEY(git_commit_id, tag_id)
        );
        CREATE TABLE IF NOT EXISTS report_tags (
          report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
          tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
          PRIMARY KEY(report_id, tag_id)
        );
        CREATE VIRTUAL TABLE IF NOT EXISTS content_search USING fts5(
          entity_type UNINDEXED,
          entity_id UNINDEXED,
          workspace_id UNINDEXED,
          content
        );
      `)
    }
  },
  {
    version: 5,
    name: '005_reports_periods',
    up: (database) => {
      addColumnIfMissing(database, 'reports', 'period_type', 'TEXT')
      addColumnIfMissing(database, 'reports', 'period_start', 'TEXT')
      addColumnIfMissing(database, 'reports', 'period_end_exclusive', 'TEXT')
      addColumnIfMissing(database, 'reports', 'time_zone', 'TEXT')
      database.exec(`
        UPDATE reports
        SET period_type = COALESCE(period_type, type),
            period_start = COALESCE(period_start, date_from),
            period_end_exclusive = COALESCE(period_end_exclusive, date(date_to, '+1 day'));
        CREATE TABLE IF NOT EXISTS report_projects (
          report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
          project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          PRIMARY KEY(report_id, project_id)
        );
        CREATE TABLE IF NOT EXISTS report_repositories (
          report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
          repository_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
          PRIMARY KEY(report_id, repository_id)
        );
      `)
    }
  },
  {
    version: 6,
    name: '006_sync_outbox',
    up: (database) => {
      database.exec(`
        CREATE TABLE IF NOT EXISTS sync_operations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          public_id TEXT NOT NULL UNIQUE,
          workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
          entity_type TEXT NOT NULL,
          entity_public_id TEXT NOT NULL,
          operation_type TEXT NOT NULL,
          payload TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          attempted_at TEXT,
          completed_at TEXT,
          failed_at TEXT,
          attempt_count INTEGER NOT NULL DEFAULT 0,
          error_message TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_sync_operations_pending ON sync_operations(workspace_id, completed_at, created_at);
      `)
    }
  },
  {
    version: 7,
    name: '007_project_inbox_contract',
    up: (database) => {
      addColumnIfMissing(database, 'projects', 'color', "TEXT NOT NULL DEFAULT '#64748b'")
      addColumnIfMissing(database, 'inbox_items', 'state', "TEXT NOT NULL DEFAULT 'unorganized' CHECK(state IN ('unorganized', 'confirmed', 'ignored', 'archived'))")
      addColumnIfMissing(database, 'inbox_items', 'include_in_reports', 'INTEGER NOT NULL DEFAULT 1 CHECK(include_in_reports IN (0, 1))')
      addColumnIfMissing(database, 'inbox_items', 'ai_suggestion', 'TEXT')
      database.exec(`
        UPDATE inbox_items
        SET state = CASE status
          WHEN 'organized' THEN 'confirmed'
          WHEN 'archived' THEN 'archived'
          ELSE 'unorganized'
        END
        WHERE state IS NULL OR state = 'unorganized';
        CREATE INDEX IF NOT EXISTS idx_projects_workspace_active ON projects(workspace_id, deleted_at, updated_at);
        CREATE INDEX IF NOT EXISTS idx_inbox_items_workspace_active ON inbox_items(workspace_id, deleted_at, created_at);
        CREATE INDEX IF NOT EXISTS idx_tags_workspace_active_path ON tags(workspace_id, deleted_at, path);
      `)
    }
  },
  {
    version: 8,
    name: '008_repository_scanning',
    up: (database) => {
      const requiredTables = [
        'workspaces',
        'users',
        'projects',
        'sync_operations',
        'repositories',
        'repository_bindings',
        'git_commits'
      ]
      const missingTables = requiredTables.filter((tableName) => !tableExists(database, tableName))
      if (missingTables.length > 0) {
        throw new Error(`Migration 008_repository_scanning requires tables: ${missingTables.join(', ')}`)
      }
      addColumnIfMissing(database, 'repositories', 'project_id', 'INTEGER REFERENCES projects(id) ON DELETE SET NULL')
      addColumnIfMissing(database, 'repositories', 'enabled', 'INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1))')
      addColumnIfMissing(database, 'repositories', 'scan_interval_minutes', 'INTEGER')
      addColumnIfMissing(database, 'repositories', 'last_scanned_at', 'TEXT')
      addColumnIfMissing(database, 'repositories', 'last_failed_at', 'TEXT')
      addColumnIfMissing(database, 'repositories', 'last_scan_error', 'TEXT')
      addColumnIfMissing(database, 'repository_bindings', 'workspace_id', 'INTEGER REFERENCES workspaces(id)')
      addColumnIfMissing(database, 'repository_bindings', 'created_by', 'INTEGER REFERENCES users(id)')
      addColumnIfMissing(database, 'repository_bindings', 'updated_by', 'INTEGER REFERENCES users(id)')
      addColumnIfMissing(database, 'git_commits', 'created_by', 'INTEGER REFERENCES users(id)')
      addColumnIfMissing(database, 'git_commits', 'updated_by', 'INTEGER REFERENCES users(id)')
      addColumnIfMissing(database, 'git_commits', 'deleted_at', 'TEXT')
      database.exec(`
        UPDATE repository_bindings
        SET workspace_id = (
          SELECT workspace_id FROM repositories WHERE repositories.id = repository_bindings.repository_id
        )
        WHERE workspace_id IS NULL;
        UPDATE repository_bindings
        SET created_by = (
          SELECT id FROM users WHERE users.workspace_id = repository_bindings.workspace_id ORDER BY id LIMIT 1
        ), updated_by = (
          SELECT id FROM users WHERE users.workspace_id = repository_bindings.workspace_id ORDER BY id LIMIT 1
        )
        WHERE created_by IS NULL OR updated_by IS NULL;
        UPDATE git_commits
        SET created_by = (
          SELECT id FROM users WHERE users.workspace_id = git_commits.workspace_id ORDER BY id LIMIT 1
        ), updated_by = (
          SELECT id FROM users WHERE users.workspace_id = git_commits.workspace_id ORDER BY id LIMIT 1
        )
        WHERE created_by IS NULL OR updated_by IS NULL;
        CREATE INDEX IF NOT EXISTS idx_repositories_workspace_active
          ON repositories(workspace_id, deleted_at, enabled, updated_at);
        CREATE INDEX IF NOT EXISTS idx_repository_bindings_repository_active
          ON repository_bindings(repository_id, deleted_at, id);
        CREATE INDEX IF NOT EXISTS idx_git_commits_repository_committed
          ON git_commits(repository_id, committed_at DESC);
        CREATE INDEX IF NOT EXISTS idx_git_commits_workspace_committed
          ON git_commits(workspace_id, committed_at DESC);
      `)
    }
  },
  {
    version: 9,
    name: '009_report_snapshots',
    up: (database) => {
      addColumnIfMissing(database, 'reports', 'timezone', 'TEXT')
      addColumnIfMissing(database, 'reports', 'project_scope', "TEXT NOT NULL DEFAULT '[]'")
      addColumnIfMissing(database, 'reports', 'repository_scope', "TEXT NOT NULL DEFAULT '[]'")
      addColumnIfMissing(database, 'reports', 'source_snapshot', "TEXT NOT NULL DEFAULT '{}'")
      addColumnIfMissing(database, 'reports', 'version', 'INTEGER NOT NULL DEFAULT 1')
      addColumnIfMissing(database, 'reports', 'status', "TEXT NOT NULL DEFAULT 'ready' CHECK(status IN ('generating', 'ready', 'error'))")
      addColumnIfMissing(database, 'reports', 'error_message', 'TEXT')
      addColumnIfMissing(database, 'reports', 'retry_count', 'INTEGER NOT NULL DEFAULT 0')
      const legacyReports = database.prepare(`
        SELECT rowid AS migration_rowid, public_id, type, period_type, period_start,
          period_end_exclusive, timezone, time_zone, date_from, date_to
        FROM reports
        WHERE source_snapshot IS NULL OR TRIM(source_snapshot) IN ('', '{}')
      `).all() as Array<{
        migration_rowid: number
        public_id: string
        type: string
        period_type: string | null
        period_start: string | null
        period_end_exclusive: string | null
        timezone: string | null
        time_zone: string | null
        date_from: string | null
        date_to: string | null
      }>
      const updateLegacyReport = database.prepare('UPDATE reports SET source_snapshot = ? WHERE rowid = ?')
      for (const report of legacyReports) {
        updateLegacyReport.run(JSON.stringify({
          schema_version: 'legacy',
          unavailable: true,
          projects: [],
          report_public_id: report.public_id,
          report_type: report.period_type ?? report.type,
          period_start: report.period_start ?? report.date_from ?? null,
          period_end: report.period_end_exclusive ?? report.date_to ?? null,
          timezone: report.timezone ?? report.time_zone ?? null,
          reason: 'source_snapshot_unavailable'
        }), report.migration_rowid)
      }
      database.exec(`
        UPDATE reports
        SET timezone = COALESCE(timezone, time_zone, 'UTC'),
            project_scope = COALESCE(project_scope, '[]'),
            repository_scope = COALESCE(repository_scope, '[]'),
            source_snapshot = COALESCE(source_snapshot, '{}'),
            version = COALESCE(version, 1),
            status = COALESCE(status, 'ready'),
            retry_count = COALESCE(retry_count, 0);
        CREATE INDEX IF NOT EXISTS idx_reports_workspace_period_version
          ON reports(workspace_id, deleted_at, type, period_start, period_end_exclusive, version DESC);
      `)
    }
  }
]

function createMigrationTable(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `)
}

function hasLegacyCoreSchema(database: Database.Database): boolean {
  return CORE_TABLES.some((tableName) => tableExists(database, tableName))
}

function migrationApplied(database: Database.Database, version: number): boolean {
  return Boolean(database.prepare('SELECT 1 FROM schema_migrations WHERE version = ?').get(version))
}

export function getDatabaseVersion(database: Database.Database): number {
  if (!tableExists(database, 'schema_migrations')) return 0
  const row = database
    .prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations')
    .get() as { version: number }
  return row.version
}

export function runMigrations(
  database: Database.Database,
  options: { now?: () => Date } = {}
): void {
  createMigrationTable(database)
  const context: MigrationContext = {
    now: options.now ?? (() => new Date())
  }

  const firstMigration = migrations[0]
  if (!migrationApplied(database, firstMigration.version) && hasLegacyCoreSchema(database)) {
    const registerBaseline = database.transaction(() => {
      database
        .prepare(`INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ${UTC_NOW_SQL})`)
        .run(firstMigration.version, firstMigration.name)
    })
    registerBaseline()
  }

  for (const migration of migrations) {
    if (migrationApplied(database, migration.version)) continue

    const apply = database.transaction(() => {
      migration.up(database, context)
      database
        .prepare(`INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ${UTC_NOW_SQL})`)
        .run(migration.version, migration.name)
    })
    apply()
  }
}

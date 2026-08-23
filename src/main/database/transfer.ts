import type Database from 'better-sqlite3'

import { getDatabaseVersion } from './connection'
import { CURRENT_SCHEMA_VERSION } from './migrations'
import type { WorkspaceContext } from '../repositories/contracts'
import { IpcContractError } from '../ipcContracts'

export interface DatabaseTransferPackage {
  format: 'workpulse-data'
  format_version: 1
  schema_version: number
  exported_at: string
  tables: Partial<Record<ExportTable, Array<Record<string, unknown>>>>
}

export interface DatabaseImportPreview {
  schema_version: number
  records: Partial<Record<ExportTable, number>>
  total_records: number
}

export interface DatabaseImportResult {
  inserted: number
  conflicts: number
  skipped: number
  conflict_public_ids: string[]
}

type ExportTable =
  | 'workspaces' | 'users' | 'projects' | 'repositories' | 'repository_bindings'
  | 'work_logs' | 'tasks' | 'inbox_items' | 'tags' | 'work_log_tags' | 'task_tags'
  | 'inbox_tags' | 'git_commits' | 'git_commit_tags' | 'reports' | 'report_projects'
  | 'report_repositories' | 'report_tags' | 'sync_operations'

const EXPORT_TABLES: readonly ExportTable[] = [
  'workspaces', 'users', 'projects', 'repositories', 'repository_bindings', 'work_logs', 'tasks',
  'inbox_items', 'tags', 'work_log_tags', 'task_tags', 'inbox_tags', 'git_commits', 'git_commit_tags',
  'reports', 'report_projects', 'report_repositories', 'report_tags', 'sync_operations'
]
const EXPORT_COLUMNS: Record<ExportTable, readonly string[]> = {
  workspaces: ['id', 'public_id', 'name', 'created_at', 'updated_at', 'deleted_at'],
  users: ['id', 'public_id', 'workspace_id', 'name', 'created_at', 'updated_at', 'deleted_at'],
  projects: ['id', 'public_id', 'name', 'description', 'color', 'created_at', 'updated_at', 'deleted_at'],
  repositories: ['id', 'public_id', 'name', 'remote_url', 'project_id', 'enabled', 'scan_interval_minutes', 'last_scanned_at', 'last_failed_at', 'last_scan_error', 'created_at', 'updated_at', 'deleted_at'],
  repository_bindings: ['id', 'public_id', 'repository_id', 'branch', 'is_valid', 'created_at', 'updated_at', 'deleted_at'],
  work_logs: ['id', 'public_id', 'project_id', 'repository_id', 'task_id', 'content', 'category', 'created_at', 'updated_at', 'deleted_at'],
  tasks: ['id', 'public_id', 'project_id', 'repository_id', 'title', 'description', 'status', 'board_column', 'position', 'created_at', 'updated_at', 'completed_at', 'due_date', 'deleted_at'],
  inbox_items: ['id', 'public_id', 'project_id', 'repository_id', 'content', 'status', 'state', 'include_in_reports', 'ai_suggestion', 'created_at', 'updated_at', 'deleted_at'],
  tags: ['id', 'public_id', 'name', 'path', 'parent_id', 'created_at', 'updated_at', 'deleted_at'],
  work_log_tags: ['work_log_id', 'tag_id'],
  task_tags: ['task_id', 'tag_id'],
  inbox_tags: ['inbox_item_id', 'tag_id'],
  git_commits: ['id', 'public_id', 'repository_id', 'commit_hash', 'author_name', 'author_email', 'committed_at', 'message', 'branch', 'files_changed', 'additions', 'deletions', 'created_at', 'updated_at', 'deleted_at'],
  git_commit_tags: ['git_commit_id', 'tag_id'],
  reports: ['id', 'public_id', 'type', 'period_type', 'date_from', 'date_to', 'period_start', 'period_end_exclusive', 'time_zone', 'timezone', 'project_scope', 'repository_scope', 'source_snapshot', 'content', 'version', 'status', 'error_message', 'retry_count', 'generated_at', 'created_at', 'updated_at', 'deleted_at'],
  report_projects: ['report_id', 'project_id'],
  report_repositories: ['report_id', 'repository_id'],
  report_tags: ['report_id', 'tag_id'],
  sync_operations: ['id', 'public_id', 'entity_type', 'entity_public_id', 'operation_type', 'payload', 'created_at', 'updated_at', 'attempted_at', 'completed_at', 'failed_at', 'attempt_count', 'error_message']
}
const IMPORT_COMPAT_COLUMNS: Record<ExportTable, readonly string[]> = {
  ...EXPORT_COLUMNS,
  workspaces: [...EXPORT_COLUMNS.workspaces, 'workspace_id', 'created_by', 'updated_by'],
  users: [...EXPORT_COLUMNS.users, 'created_by', 'updated_by'],
  projects: [...EXPORT_COLUMNS.projects, 'workspace_id', 'created_by', 'updated_by'],
  repositories: [...EXPORT_COLUMNS.repositories, 'workspace_id', 'created_by', 'updated_by'],
  repository_bindings: [...EXPORT_COLUMNS.repository_bindings, 'workspace_id', 'created_by', 'updated_by', 'local_path'],
  work_logs: [...EXPORT_COLUMNS.work_logs, 'workspace_id', 'created_by', 'updated_by'],
  tasks: [...EXPORT_COLUMNS.tasks, 'workspace_id', 'created_by', 'updated_by'],
  inbox_items: [...EXPORT_COLUMNS.inbox_items, 'workspace_id', 'created_by', 'updated_by'],
  tags: [...EXPORT_COLUMNS.tags, 'workspace_id'],
  git_commits: [...EXPORT_COLUMNS.git_commits, 'workspace_id', 'created_by', 'updated_by'],
  reports: [...EXPORT_COLUMNS.reports, 'workspace_id', 'created_by', 'updated_by'],
  sync_operations: [...EXPORT_COLUMNS.sync_operations, 'workspace_id'],
  work_log_tags: EXPORT_COLUMNS.work_log_tags,
  task_tags: EXPORT_COLUMNS.task_tags,
  inbox_tags: EXPORT_COLUMNS.inbox_tags,
  git_commit_tags: EXPORT_COLUMNS.git_commit_tags,
  report_projects: EXPORT_COLUMNS.report_projects,
  report_repositories: EXPORT_COLUMNS.report_repositories,
  report_tags: EXPORT_COLUMNS.report_tags
}
const IMPORT_ORDER: readonly ExportTable[] = [
  'projects', 'tags', 'repositories', 'repository_bindings', 'tasks', 'work_logs', 'inbox_items',
  'git_commits', 'reports', 'sync_operations', 'work_log_tags', 'task_tags', 'inbox_tags',
  'git_commit_tags', 'report_projects', 'report_repositories', 'report_tags'
]
const LINK_TABLES = new Set<ExportTable>([
  'work_log_tags', 'task_tags', 'inbox_tags', 'git_commit_tags', 'report_projects', 'report_repositories', 'report_tags'
])
const FOREIGN_KEYS: Partial<Record<ExportTable, Record<string, ExportTable>>> = {
  repositories: { project_id: 'projects' },
  repository_bindings: { repository_id: 'repositories' },
  tasks: { project_id: 'projects', repository_id: 'repositories' },
  work_logs: { task_id: 'tasks', project_id: 'projects', repository_id: 'repositories' },
  inbox_items: { project_id: 'projects', repository_id: 'repositories' },
  tags: { parent_id: 'tags' },
  git_commits: { repository_id: 'repositories' },
  work_log_tags: { work_log_id: 'work_logs', tag_id: 'tags' },
  task_tags: { task_id: 'tasks', tag_id: 'tags' },
  inbox_tags: { inbox_item_id: 'inbox_items', tag_id: 'tags' },
  git_commit_tags: { git_commit_id: 'git_commits', tag_id: 'tags' },
  report_projects: { report_id: 'reports', project_id: 'projects' },
  report_repositories: { report_id: 'reports', repository_id: 'repositories' },
  report_tags: { report_id: 'reports', tag_id: 'tags' }
}
const MAX_IMPORT_BYTES = 20 * 1024 * 1024

function importError(code: 'IMPORT_INVALID' | 'IMPORT_TOO_LARGE', message: string): IpcContractError {
  return new IpcContractError(code, message)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function hasTable(database: Database.Database, table: string): boolean {
  return Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table))
}

function columns(database: Database.Database, table: string): Set<string> {
  return new Set((database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((row) => row.name))
}

function parsePackage(value: unknown): DatabaseTransferPackage {
  if (!isRecord(value) || value.format !== 'workpulse-data' || value.format_version !== 1 || !Number.isSafeInteger(value.schema_version) || (value.schema_version as number) > CURRENT_SCHEMA_VERSION || !isRecord(value.tables)) {
    throw importError('IMPORT_INVALID', 'Invalid data package')
  }
  const serialized = JSON.stringify(value)
  if (Buffer.byteLength(serialized, 'utf8') > MAX_IMPORT_BYTES) throw importError('IMPORT_TOO_LARGE', 'Data package is too large')
  const tables: DatabaseTransferPackage['tables'] = {}
  for (const [name, rows] of Object.entries(value.tables)) {
    if (!EXPORT_TABLES.includes(name as ExportTable) || !Array.isArray(rows) || rows.some((row) => !isRecord(row))) {
      throw importError('IMPORT_INVALID', 'Invalid table data')
    }
    const table = name as ExportTable
    const allowedColumns = new Set(IMPORT_COMPAT_COLUMNS[table])
    if (rows.some((row) => Object.keys(row).some((column) => !allowedColumns.has(column)))) {
      throw importError('IMPORT_INVALID', `Unknown ${name} column`)
    }
    if (rows.length > 100_000) throw importError('IMPORT_TOO_LARGE', 'Too many records')
    tables[name as ExportTable] = rows as Array<Record<string, unknown>>
  }
  return {
    format: 'workpulse-data',
    format_version: 1,
    schema_version: value.schema_version as number,
    exported_at: typeof value.exported_at === 'string' ? value.exported_at : '',
    tables
  }
}

export function createDatabaseExport(database: Database.Database, context: WorkspaceContext): DatabaseTransferPackage {
  database.pragma('wal_checkpoint(PASSIVE)')
  const tables: DatabaseTransferPackage['tables'] = {}
  for (const table of EXPORT_TABLES) {
    if (!hasTable(database, table)) continue
    const tableColumns = columns(database, table)
    const selectedColumns = EXPORT_COLUMNS[table].filter((column) => tableColumns.has(column))
    if (selectedColumns.length === 0) continue
    const scope = tableColumns.has('workspace_id') ? ' WHERE workspace_id = ?' : ''
    tables[table] = database.prepare(`SELECT ${selectedColumns.join(', ')} FROM ${table}${scope}`).all(...(scope ? [context.workspace_id] : [])) as Array<Record<string, unknown>>
  }
  const payload: DatabaseTransferPackage = {
    format: 'workpulse-data',
    format_version: 1,
    schema_version: getDatabaseVersion(database),
    exported_at: new Date().toISOString(),
    tables
  }
  assertPackageSize(payload)
  return payload
}

function assertPackageSize(payload: DatabaseTransferPackage): void {
  if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > MAX_IMPORT_BYTES) {
    throw importError('IMPORT_TOO_LARGE', 'Data package is too large')
  }
}

export function previewDatabaseImport(value: unknown): DatabaseImportPreview {
  const data = parsePackage(value)
  const records: DatabaseImportPreview['records'] = {}
  let totalRecords = 0
  for (const table of EXPORT_TABLES) {
    const count = data.tables[table]?.length ?? 0
    if (count) records[table] = count
    totalRecords += count
  }
  return { schema_version: data.schema_version, records, total_records: totalRecords }
}

export function mergeDatabaseImport(
  database: Database.Database,
  context: WorkspaceContext,
  value: unknown
): DatabaseImportResult {
  const data = parsePackage(value)
  const result: DatabaseImportResult = { inserted: 0, conflicts: 0, skipped: 0, conflict_public_ids: [] }
  const idMaps = new Map<ExportTable, Map<number, number>>()
  const transaction = database.transaction(() => {
    for (const table of IMPORT_ORDER) {
      for (const sourceRow of data.tables[table] ?? []) {
        if (LINK_TABLES.has(table)) mergeLink(database, table, sourceRow, idMaps, result)
        else mergeEntity(database, context, table, sourceRow, idMaps, result)
      }
    }
  })
  transaction()
  return result
}

function sourceId(value: unknown, table: ExportTable): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) throw importError('IMPORT_INVALID', `Invalid ${table} id`)
  return value as number
}

function mapForeignKeys(
  table: ExportTable,
  row: Record<string, unknown>,
  idMaps: Map<ExportTable, Map<number, number>>
): void {
  for (const [column, sourceTable] of Object.entries(FOREIGN_KEYS[table] ?? {})) {
    const sourceValue = row[column]
    if (sourceValue === null || sourceValue === undefined) continue
    const mapped = idMaps.get(sourceTable)?.get(sourceId(sourceValue, sourceTable))
    if (!mapped) throw importError('IMPORT_INVALID', `Unresolved ${table}.${column}`)
    row[column] = mapped
  }
}

function mergeEntity(
  database: Database.Database,
  context: WorkspaceContext,
  table: ExportTable,
  sourceRow: Record<string, unknown>,
  idMaps: Map<ExportTable, Map<number, number>>,
  result: DatabaseImportResult
): void {
  const incomingId = sourceId(sourceRow.id, table)
  const tableColumns = columns(database, table)
  const publicId = sourceRow.public_id
  if (typeof publicId !== 'string' || !publicId) {
    throw importError('IMPORT_INVALID', `Invalid ${table} public_id`)
  }
  const existing = database.prepare(`SELECT id FROM ${table} WHERE public_id = ?`).get(publicId) as { id: number } | undefined
  if (existing) {
    setIdMap(idMaps, table, incomingId, existing.id)
    result.conflicts += 1
    if (result.conflict_public_ids.length < 100) result.conflict_public_ids.push(publicId)
    return
  }
  const row: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(sourceRow)) {
    if (key === 'id' || key === 'workspace_id' || key === 'created_by' || key === 'updated_by' || !tableColumns.has(key)) continue
    row[key] = value
  }
  if (!row.created_at || !row.updated_at) throw importError('IMPORT_INVALID', `Invalid ${table} record`)
  if (tableColumns.has('workspace_id')) row.workspace_id = context.workspace_id
  if (tableColumns.has('created_by')) row.created_by = context.user_id
  if (tableColumns.has('updated_by')) row.updated_by = context.user_id
  mapForeignKeys(table, row, idMaps)
  if (table === 'repository_bindings') {
    row.local_path = ''
    if (tableColumns.has('is_valid')) row.is_valid = 0
    const binding = database.prepare('SELECT id FROM repository_bindings WHERE repository_id = ? AND local_path = ?').get(row.repository_id, '') as { id: number } | undefined
    if (binding) {
      setIdMap(idMaps, table, incomingId, binding.id)
      result.conflicts += 1
      return
    }
  }
  const names = Object.keys(row)
  if (!names.includes('public_id')) throw importError('IMPORT_INVALID', `Invalid ${table} public_id`)
  const placeholders = names.map(() => '?').join(', ')
  const inserted = database.prepare(`INSERT INTO ${table} (${names.join(', ')}) VALUES (${placeholders})`).run(...names.map((name) => row[name]))
  setIdMap(idMaps, table, incomingId, Number(inserted.lastInsertRowid))
  result.inserted += 1
}

function mergeLink(
  database: Database.Database,
  table: ExportTable,
  sourceRow: Record<string, unknown>,
  idMaps: Map<ExportTable, Map<number, number>>,
  result: DatabaseImportResult
): void {
  const row: Record<string, unknown> = { ...sourceRow }
  mapForeignKeys(table, row, idMaps)
  const names = Object.keys(FOREIGN_KEYS[table] ?? {})
  if (names.some((name) => !Number.isSafeInteger(row[name]))) throw importError('IMPORT_INVALID', `Invalid ${table} link`)
  const inserted = database.prepare(`INSERT OR IGNORE INTO ${table} (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`)
    .run(...names.map((name) => row[name]))
  if (inserted.changes > 0) result.inserted += 1
  else result.conflicts += 1
}

function setIdMap(idMaps: Map<ExportTable, Map<number, number>>, table: ExportTable, sourceIdValue: number, destinationId: number): void {
  const map = idMaps.get(table) ?? new Map<number, number>()
  map.set(sourceIdValue, destinationId)
  idMaps.set(table, map)
}

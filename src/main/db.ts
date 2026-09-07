import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import { randomUUID } from 'node:crypto'

import { backupDatabase, getDatabaseVersion, initializeDatabase, pruneBackups, runMigrations } from './database/connection'
import type { WorkspaceContext } from './repositories/contracts'
import { displayTagName, escapeLikePattern, normalizeTagName } from './repositories/localTagRepository'
import { assertStatsDays, DEFAULT_STATS_DAYS } from './lib/stats'
import { buildFtsQuery } from './search/ftsQuery'
import { isTaskPriority, normalizeChecklist, parseChecklist, type TaskChecklistItem, type TaskPriority } from './kanban/kanbanTypes'
import { normalizeTaskBoardState } from './kanban/kanbanState'
import { enqueueOutbox, getPendingOutboxCount } from './sync/outbox'
import type { StagedAttachmentClear } from './attachments/attachmentStorage'

let db: Database.Database

const DB_NAME = 'workpulse.db'

function formatLocalDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getLocalDayBounds(value: string): { fromUtc: string; toUtc: string } | null {
  const datePart = value.slice(0, 10)
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart)
  if (!match) return null
  const localStart = new Date()
  localStart.setHours(0, 0, 0, 0)
  localStart.setFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  if (formatLocalDate(localStart) !== datePart) return null
  const localEnd = new Date(localStart)
  localEnd.setDate(localEnd.getDate() + 1)
  return { fromUtc: localStart.toISOString(), toUtc: localEnd.toISOString() }
}

function getDbPath(): string {
  const userDataPath = app.getPath('userData')
  return join(userDataPath, DB_NAME)
}

function getBackupPath(migrationVersion: number): string {
  const userDataPath = app.getPath('userData')
  const backupDir = join(userDataPath, 'backups')
  if (!existsSync(backupDir)) {
    mkdirSync(backupDir, { recursive: true })
  }
  const date = formatLocalDate(new Date())
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  return join(backupDir, `workpulse-${date}-v${migrationVersion}-${timestamp}-${randomUUID()}.db`)
}

function runIntegrityCheck(): boolean {
  try {
    const result = db.pragma('integrity_check') as { integrity_check: string }[]
    return result[0]?.integrity_check === 'ok'
  } catch {
    return false
  }
}

interface WriteMetadata {
  publicId: string
  workspaceId: number
  userId: number
  timestamp: string
}

function getWriteMetadata(createdAt?: string): WriteMetadata {
  const context = db.prepare(`
    SELECT workspaces.id AS workspace_id, users.id AS user_id
    FROM workspaces
    INNER JOIN users ON users.workspace_id = workspaces.id
    ORDER BY workspaces.id, users.id
    LIMIT 1
  `).get() as { workspace_id: number; user_id: number } | undefined
  if (!context) {
    throw new Error('Default local workspace is not initialized')
  }

  const parsedCreatedAt = createdAt ? new Date(createdAt) : new Date()
  const timestamp = Number.isNaN(parsedCreatedAt.getTime())
    ? new Date().toISOString()
    : parsedCreatedAt.toISOString()
  return {
    publicId: randomUUID(),
    workspaceId: context.workspace_id,
    userId: context.user_id,
    timestamp
  }
}

export async function initDatabase(): Promise<void> {
  const dbPath = getDbPath()
  db = await initializeDatabase(
    dbPath,
    async (database) => {
      await backupDatabase(database, getBackupPath(getDatabaseVersion(database)))
      pruneBackups(join(app.getPath('userData'), 'backups'))
    },
    (database) => runMigrations(database)
  )

  if (!runIntegrityCheck()) {
    throw new Error('Database integrity check failed')
  }
  cleanupSyncOperations()
}

export function getDatabase(): Database.Database {
  return db
}

export function getPendingSyncOperationCount(): number {
  return getPendingOutboxCount(db, getDefaultWorkspaceContext().workspace_id)
}

/** The local outbox has no remote consumer yet; bound terminal history without dropping pending work. */
export function cleanupSyncOperations(): number {
  const result = db.prepare(`
    DELETE FROM sync_operations
    WHERE (completed_at IS NOT NULL AND completed_at < datetime('now', '-30 days'))
       OR (failed_at IS NOT NULL AND failed_at < datetime('now', '-90 days'))
       OR (
         (completed_at IS NOT NULL OR failed_at IS NOT NULL)
         AND id NOT IN (
           SELECT id FROM sync_operations
           WHERE completed_at IS NOT NULL OR failed_at IS NOT NULL
           ORDER BY id DESC LIMIT 5000
         )
       )
  `).run()
  return result.changes
}

export function getDefaultWorkspaceContext(): WorkspaceContext {
  const context = db.prepare(`
    SELECT workspaces.id AS workspace_id, users.id AS user_id
    FROM workspaces
    INNER JOIN users ON users.workspace_id = workspaces.id
    WHERE workspaces.deleted_at IS NULL AND users.deleted_at IS NULL
    ORDER BY workspaces.id, users.id
    LIMIT 1
  `).get() as WorkspaceContext | undefined
  if (!context) throw new Error('Default local workspace is not initialized')
  return context
}

export interface ClearWorkspaceDataResult {
  backupPath: string
  deleted: Record<string, number>
}

interface ClearWorkspaceOperation {
  table: string
  countSql: string
  deleteSql: string
}

const CLEAR_WORKSPACE_OPERATIONS: ClearWorkspaceOperation[] = [
  {
    table: 'work_log_tags',
    countSql: 'SELECT COUNT(*) AS count FROM work_log_tags WHERE work_log_id IN (SELECT id FROM work_logs WHERE workspace_id = ?)',
    deleteSql: 'DELETE FROM work_log_tags WHERE work_log_id IN (SELECT id FROM work_logs WHERE workspace_id = ?)'
  },
  {
    table: 'task_tags',
    countSql: 'SELECT COUNT(*) AS count FROM task_tags WHERE task_id IN (SELECT id FROM tasks WHERE workspace_id = ?)',
    deleteSql: 'DELETE FROM task_tags WHERE task_id IN (SELECT id FROM tasks WHERE workspace_id = ?)'
  },
  {
    table: 'inbox_tags',
    countSql: 'SELECT COUNT(*) AS count FROM inbox_tags WHERE inbox_item_id IN (SELECT id FROM inbox_items WHERE workspace_id = ?)',
    deleteSql: 'DELETE FROM inbox_tags WHERE inbox_item_id IN (SELECT id FROM inbox_items WHERE workspace_id = ?)'
  },
  {
    table: 'git_commit_tags',
    countSql: 'SELECT COUNT(*) AS count FROM git_commit_tags WHERE git_commit_id IN (SELECT id FROM git_commits WHERE workspace_id = ?)',
    deleteSql: 'DELETE FROM git_commit_tags WHERE git_commit_id IN (SELECT id FROM git_commits WHERE workspace_id = ?)'
  },
  {
    table: 'report_tags',
    countSql: 'SELECT COUNT(*) AS count FROM report_tags WHERE report_id IN (SELECT id FROM reports WHERE workspace_id = ?)',
    deleteSql: 'DELETE FROM report_tags WHERE report_id IN (SELECT id FROM reports WHERE workspace_id = ?)'
  },
  {
    table: 'report_projects',
    countSql: 'SELECT COUNT(*) AS count FROM report_projects WHERE report_id IN (SELECT id FROM reports WHERE workspace_id = ?)',
    deleteSql: 'DELETE FROM report_projects WHERE report_id IN (SELECT id FROM reports WHERE workspace_id = ?)'
  },
  {
    table: 'report_repositories',
    countSql: 'SELECT COUNT(*) AS count FROM report_repositories WHERE report_id IN (SELECT id FROM reports WHERE workspace_id = ?)',
    deleteSql: 'DELETE FROM report_repositories WHERE report_id IN (SELECT id FROM reports WHERE workspace_id = ?)'
  },
  {
    table: 'repository_bindings',
    countSql: 'SELECT COUNT(*) AS count FROM repository_bindings WHERE workspace_id = ?',
    deleteSql: 'DELETE FROM repository_bindings WHERE workspace_id = ?'
  },
  {
    table: 'git_commits',
    countSql: 'SELECT COUNT(*) AS count FROM git_commits WHERE workspace_id = ?',
    deleteSql: 'DELETE FROM git_commits WHERE workspace_id = ?'
  },
  {
    table: 'inbox_items',
    countSql: 'SELECT COUNT(*) AS count FROM inbox_items WHERE workspace_id = ?',
    deleteSql: 'DELETE FROM inbox_items WHERE workspace_id = ?'
  },
  {
    table: 'work_logs',
    countSql: 'SELECT COUNT(*) AS count FROM work_logs WHERE workspace_id = ?',
    deleteSql: 'DELETE FROM work_logs WHERE workspace_id = ?'
  },
  {
    table: 'tasks',
    countSql: 'SELECT COUNT(*) AS count FROM tasks WHERE workspace_id = ?',
    deleteSql: 'DELETE FROM tasks WHERE workspace_id = ?'
  },
  {
    table: 'reports',
    countSql: 'SELECT COUNT(*) AS count FROM reports WHERE workspace_id = ?',
    deleteSql: 'DELETE FROM reports WHERE workspace_id = ?'
  },
  {
    table: 'repositories',
    countSql: 'SELECT COUNT(*) AS count FROM repositories WHERE workspace_id = ?',
    deleteSql: 'DELETE FROM repositories WHERE workspace_id = ?'
  },
  {
    table: 'projects',
    countSql: 'SELECT COUNT(*) AS count FROM projects WHERE workspace_id = ?',
    deleteSql: 'DELETE FROM projects WHERE workspace_id = ?'
  },
  {
    table: 'tags',
    countSql: 'SELECT COUNT(*) AS count FROM tags WHERE workspace_id = ?',
    deleteSql: 'DELETE FROM tags WHERE workspace_id = ?'
  },
  {
    table: 'sync_operations',
    countSql: 'SELECT COUNT(*) AS count FROM sync_operations WHERE workspace_id = ?',
    deleteSql: 'DELETE FROM sync_operations WHERE workspace_id = ?'
  },
  {
    table: 'content_search',
    countSql: 'SELECT COUNT(*) AS count FROM content_search WHERE workspace_id = ?',
    deleteSql: 'DELETE FROM content_search WHERE workspace_id = ?'
  }
]

export async function clearWorkspaceData(
  createBackup?: (database: Database.Database) => Promise<string>,
  stageAttachments?: () => StagedAttachmentClear
): Promise<ClearWorkspaceDataResult> {
  const context = getDefaultWorkspaceContext()
  const backupPath = createBackup
    ? await createBackup(db)
    : getBackupPath(getDatabaseVersion(db))
  if (!createBackup) await backupDatabase(db, backupPath)
  const stagedAttachments = stageAttachments?.()

  let deleted: Record<string, number>
  try {
    deleted = db.transaction(() => {
      const counts: Record<string, number> = {}
      for (const operation of CLEAR_WORKSPACE_OPERATIONS) {
        const row = db.prepare(operation.countSql).get(context.workspace_id) as { count: number }
        counts[operation.table] = row.count
        db.prepare(operation.deleteSql).run(context.workspace_id)
      }
      stagedAttachments?.discard()
      return counts
    })()
  } catch (error) {
    try { stagedAttachments?.restore() } catch { /* Preserve the original database error. */ }
    throw error
  }

  return { backupPath, deleted }
}

// --- Work Logs CRUD ---

export interface WorkLog {
  id: number
  public_id: string
  content: string
  category: string
  created_at: string
  task_id: number | null
  project_id: string | null
  tag_names: string[]
}

export interface WorkItemAssociations {
  projectId?: string | null
  tagNames?: string[]
}

function resolveProjectId(publicId: string | null | undefined, workspaceId: number): number | null | undefined {
  if (publicId === undefined) return undefined
  if (publicId === null) return null
  const row = db.prepare('SELECT id FROM projects WHERE workspace_id = ? AND public_id = ? AND deleted_at IS NULL').get(workspaceId, publicId) as { id: number } | undefined
  if (!row) throw new Error('Project not found')
  return row.id
}

function associationPatch(associations: WorkItemAssociations): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  if (associations.projectId !== undefined) patch.project_id = associations.projectId
  if (associations.tagNames !== undefined) patch.tag_names = associations.tagNames
  return patch
}

function ensureTagIds(names: string[], workspaceId: number, userId: number, now: string): number[] {
  const ids: number[] = []
  for (const rawName of Array.from(new Set(names))) {
    const path = normalizeTagName(rawName)
    const display = displayTagName(rawName)
    const existing = db.prepare('SELECT id, public_id, deleted_at, display_path FROM tags WHERE workspace_id = ? AND path = ?').get(workspaceId, path) as { id: number; public_id: string; deleted_at: string | null; display_path: string | null } | undefined
    let tagId = existing?.id
    if (existing && tagId && existing.deleted_at !== null) {
      db.prepare('UPDATE tags SET deleted_at = NULL, updated_at = ? WHERE id = ? AND workspace_id = ?').run(now, tagId, workspaceId)
      enqueueOutbox(db, workspaceId, { entity: 'tag', publicId: existing.public_id, operationType: 'update', action: 'restore', changedAt: now, data: { path, display_path: existing.display_path ?? display, deleted_at: null } })
    }
    // 老数据（迁移回填前 display_path 为 NULL）：首次再次使用时以当次输入的大小写作为展示名
    if (existing && tagId && existing.display_path == null) {
      db.prepare('UPDATE tags SET display_path = ?, updated_at = ? WHERE id = ? AND workspace_id = ?').run(display, now, tagId, workspaceId)
    }
    if (!tagId) {
      const tag = db.prepare(`INSERT INTO tags (public_id, workspace_id, name, path, display_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id, public_id`).get(randomUUID(), workspaceId, display, path, display, now, now) as { id: number; public_id: string }
      tagId = tag.id
      enqueueOutbox(db, workspaceId, { entity: 'tag', publicId: tag.public_id, operationType: 'create', changedAt: now, data: { path, display_path: display } })
    }
    ids.push(tagId)
  }
  return ids
}

function cleanupUnusedTags(workspaceId: number, now: string): void {
  const candidates = db.prepare(`
    SELECT id, public_id, path
    FROM tags
    WHERE workspace_id = ? AND deleted_at IS NULL
    ORDER BY LENGTH(path) DESC, path DESC
  `).all(workspaceId) as Array<{ id: number; public_id: string; path: string }>
  const usage = db.prepare(`
    WITH candidate_tags AS (
      SELECT id FROM tags
      WHERE workspace_id = ? AND deleted_at IS NULL AND (id = ? OR path LIKE ? ESCAPE '!')
    )
    SELECT 1
    FROM work_log_tags
    INNER JOIN work_logs ON work_logs.id = work_log_tags.work_log_id
    WHERE work_log_tags.tag_id IN (SELECT id FROM candidate_tags)
      AND work_logs.workspace_id = ? AND work_logs.deleted_at IS NULL
    UNION ALL
    SELECT 1
    FROM task_tags
    INNER JOIN tasks ON tasks.id = task_tags.task_id
    WHERE task_tags.tag_id IN (SELECT id FROM candidate_tags)
      AND tasks.workspace_id = ? AND tasks.deleted_at IS NULL
    UNION ALL
    SELECT 1
    FROM inbox_tags
    INNER JOIN inbox_items ON inbox_items.id = inbox_tags.inbox_item_id
    WHERE inbox_tags.tag_id IN (SELECT id FROM candidate_tags)
      AND inbox_items.workspace_id = ? AND inbox_items.deleted_at IS NULL
    UNION ALL
    SELECT 1
    FROM git_commit_tags
    INNER JOIN git_commits ON git_commits.id = git_commit_tags.git_commit_id
    WHERE git_commit_tags.tag_id IN (SELECT id FROM candidate_tags)
      AND git_commits.workspace_id = ? AND git_commits.deleted_at IS NULL
    UNION ALL
    SELECT 1
    FROM report_tags
    INNER JOIN reports ON reports.id = report_tags.report_id
    WHERE report_tags.tag_id IN (SELECT id FROM candidate_tags)
      AND reports.workspace_id = ? AND reports.deleted_at IS NULL
    LIMIT 1
  `)
  const remove = db.prepare('UPDATE tags SET deleted_at = ?, updated_at = ? WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL')
  for (const tag of candidates) {
    const used = usage.get(workspaceId, tag.id, `${escapeLikePattern(tag.path)}/%`, workspaceId, workspaceId, workspaceId, workspaceId, workspaceId)
    if (used) continue
    if (remove.run(now, now, tag.id, workspaceId).changes > 0) {
      enqueueOutbox(db, workspaceId, { entity: 'tag', publicId: tag.public_id, operationType: 'delete', changedAt: now, data: { path: tag.path, deleted_at: now } })
    }
  }
}

function setEntityTags(linkTable: 'work_log_tags' | 'task_tags', entityColumn: 'work_log_id' | 'task_id', entityId: number, entityPublicId: string, names: string[] | undefined, workspaceId: number, userId: number, now: string): void {
  if (names === undefined) return
  db.prepare(`DELETE FROM ${linkTable} WHERE ${entityColumn} = ?`).run(entityId)
  const tagIds = ensureTagIds(names, workspaceId, userId, now)
  const insert = db.prepare(`INSERT OR IGNORE INTO ${linkTable} (${entityColumn}, tag_id) VALUES (?, ?)`)
  for (const tagId of tagIds) insert.run(entityId, tagId)
  enqueueOutbox(db, workspaceId, { entity: linkTable, publicId: entityPublicId, operationType: 'update', changedAt: now, data: { tag_names: names } })
  cleanupUnusedTags(workspaceId, now)
}

function tagNames(linkTable: 'work_log_tags' | 'task_tags', entityColumn: 'work_log_id' | 'task_id', entityId: number): string[] {
  const rows = db.prepare(`SELECT COALESCE(tags.display_path, tags.path) AS name FROM ${linkTable} INNER JOIN tags ON tags.id = ${linkTable}.tag_id WHERE ${linkTable}.${entityColumn} = ? AND tags.deleted_at IS NULL ORDER BY tags.path`).all(entityId) as Array<{ name: string }>
  return rows.map((row) => row.name)
}

function restoreEntityTags(linkTable: 'work_log_tags' | 'task_tags', entityColumn: 'work_log_id' | 'task_id', entityId: number, workspaceId: number, now: string): void {
  const tags = db.prepare(`SELECT tags.id, tags.public_id, tags.path, COALESCE(tags.display_path, tags.path) AS display FROM ${linkTable} INNER JOIN tags ON tags.id = ${linkTable}.tag_id WHERE ${linkTable}.${entityColumn} = ? AND tags.workspace_id = ? AND tags.deleted_at IS NOT NULL`).all(entityId, workspaceId) as Array<{ id: number; public_id: string; path: string; display: string }>
  const restore = db.prepare('UPDATE tags SET deleted_at = NULL, updated_at = ? WHERE id = ? AND workspace_id = ?')
  for (const tag of tags) {
    restore.run(now, tag.id, workspaceId)
    enqueueOutbox(db, workspaceId, { entity: 'tag', publicId: tag.public_id, operationType: 'update', action: 'restore', changedAt: now, data: { path: tag.path, display_path: tag.display, deleted_at: null } })
  }
}

function enqueueEntitySync(entityType: 'work_log' | 'task' | 'kanban_column', entityPublicId: string, payload: unknown, workspaceId: number, now: string, operationType: 'create' | 'update' | 'delete' = 'update'): void {
  enqueueOutbox(db, workspaceId, {
    entity: entityType,
    publicId: entityPublicId,
    operationType,
    changedAt: now,
    data: payload
  })
}

export interface NewWorkLogInput {
  content: string
  category?: string
  taskId?: number | null
  createdAt?: string
  associations?: WorkItemAssociations
}

function insertWorkLog(input: NewWorkLogInput, metadata: WriteMetadata): string {
  const resolvedTaskId = resolveWorkLogTaskId(input.taskId ?? null, metadata.workspaceId)
  const associations = input.associations ?? {}
  const projectId = resolveProjectId(associations.projectId, metadata.workspaceId)
  const result = db.prepare(
    `INSERT INTO work_logs (content, category, task_id, project_id, created_at, updated_at, public_id, workspace_id, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(input.content, input.category ?? '', resolvedTaskId, projectId ?? null, metadata.timestamp, metadata.timestamp, metadata.publicId, metadata.workspaceId, metadata.userId, metadata.userId)
  setEntityTags('work_log_tags', 'work_log_id', Number(result.lastInsertRowid), metadata.publicId, associations.tagNames, metadata.workspaceId, metadata.userId, metadata.timestamp)
  enqueueEntitySync('work_log', metadata.publicId, { content: input.content, category: input.category ?? '', ...associationPatch(associations) }, metadata.workspaceId, metadata.timestamp, 'create')
  return metadata.publicId
}

function resolveWorkLogTaskId(taskId: number | null, workspaceId: number): number | null {
  if (taskId === null) return null
  const exists = db.prepare('SELECT 1 FROM tasks WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL').get(taskId, workspaceId)
  return exists ? taskId : null
}

export function addWorkLog(
  content: string,
  category = '',
  taskId: number | null = null,
  createdAt?: string,
  associations: WorkItemAssociations = {}
): WorkLog {
  const metadata = getWriteMetadata(createdAt)
  const create = db.transaction(() => {
    return insertWorkLog({ content, category, taskId, createdAt, associations }, metadata)
  })
  return getWorkLogById(create(), metadata.workspaceId)!
}

export function addWorkLogsBatch(inputs: NewWorkLogInput[]): WorkLog[] {
  if (inputs.length === 0) return []
  const publicIds = db.transaction(() => inputs.map((input) => {
    const metadata = getWriteMetadata(input.createdAt)
    return insertWorkLog(input, metadata)
  }))()
  return publicIds.map((publicId) => getWorkLogByPublicId(publicId)).filter((log): log is WorkLog => log !== null)
}

function getWorkLogById(publicId: string, workspaceId: number): WorkLog | null {
  const row = db.prepare(`
    SELECT work_logs.id, work_logs.public_id, work_logs.content, work_logs.category, work_logs.created_at, work_logs.task_id,
      projects.public_id AS project_public_id
    FROM work_logs
    LEFT JOIN projects ON projects.id = work_logs.project_id AND projects.workspace_id = work_logs.workspace_id AND projects.deleted_at IS NULL
    WHERE work_logs.workspace_id = ? AND work_logs.public_id = ? AND work_logs.deleted_at IS NULL
  `).get(workspaceId, publicId) as { id: number; public_id: string; content: string; category: string; created_at: string; task_id: number | null; project_public_id: string | null } | undefined
  if (!row) return null
  return toWorkLog(row)
}

type WorkLogRow = { id: number; public_id: string; content: string; category: string; created_at: string; task_id: number | null; project_public_id: string | null }

function toWorkLog(row: WorkLogRow, names?: string[]): WorkLog {
  return { id: row.id, public_id: row.public_id, content: row.content, category: row.category, created_at: row.created_at, task_id: row.task_id, project_id: row.project_public_id, tag_names: names ?? tagNames('work_log_tags', 'work_log_id', row.id) }
}

export function getWorkLogByPublicId(publicId: string): WorkLog | null {
  return getWorkLogById(publicId, getDefaultWorkspaceContext().workspace_id)
}

interface WorkLogTagFilter {
  sql: string
  params: string[]
}

function buildWorkLogTagFilter(tagPath?: string): WorkLogTagFilter {
  if (!tagPath?.trim()) return { sql: '', params: [] }
  const normalizedPath = normalizeTagName(tagPath)
  return {
    sql: `
      AND EXISTS (
        SELECT 1
        FROM work_log_tags
        INNER JOIN tags ON tags.id = work_log_tags.tag_id
        WHERE work_log_tags.work_log_id = work_logs.id
          AND tags.workspace_id = work_logs.workspace_id
          AND tags.deleted_at IS NULL
          AND (tags.path = ? OR tags.path LIKE ? ESCAPE '!')
      )`,
    params: [normalizedPath, `${escapeLikePattern(normalizedPath)}/%`]
  }
}

function buildWorkLogProjectFilter(projectPublicId?: string): WorkLogTagFilter {
  const normalizedProjectId = projectPublicId?.trim()
  if (!normalizedProjectId) return { sql: '', params: [] }
  return {
    sql: `
      AND EXISTS (
        SELECT 1
        FROM projects
        WHERE projects.id = work_logs.project_id
          AND projects.workspace_id = work_logs.workspace_id
          AND projects.public_id = ?
          AND projects.deleted_at IS NULL
      )`,
    params: [normalizedProjectId]
  }
}

export function getWorkLogs(limit = 200, offset = 0, tagPath?: string, projectPublicId?: string): WorkLog[] {
  const workspaceId = getDefaultWorkspaceContext().workspace_id
  const tagFilter = buildWorkLogTagFilter(tagPath)
  const projectFilter = buildWorkLogProjectFilter(projectPublicId)
  const rows = db.prepare(`
    SELECT work_logs.public_id
    FROM work_logs
    WHERE work_logs.workspace_id = ? AND work_logs.deleted_at IS NULL
    ${tagFilter.sql}
    ${projectFilter.sql}
    ORDER BY work_logs.created_at DESC
    LIMIT ? OFFSET ?
  `).all(workspaceId, ...tagFilter.params, ...projectFilter.params, limit, offset) as Array<{ public_id: string }>
  return rows.map((row) => getWorkLogById(row.public_id, workspaceId)).filter((row): row is WorkLog => row !== null)
}

export function getWorkLogsByDateRange(from: string, to: string): WorkLog[] {
  const workspaceId = getDefaultWorkspaceContext().workspace_id
  const fromBounds = getLocalDayBounds(from)
  const toBounds = getLocalDayBounds(to)
  if (!fromBounds || !toBounds || fromBounds.fromUtc > toBounds.fromUtc) return []
  const rows = db.prepare('SELECT public_id FROM work_logs WHERE workspace_id = ? AND deleted_at IS NULL AND created_at >= ? AND created_at < ? ORDER BY created_at ASC').all(workspaceId, fromBounds.fromUtc, toBounds.toUtc) as Array<{ public_id: string }>
  return rows.map((row) => getWorkLogById(row.public_id, workspaceId)).filter((row): row is WorkLog => row !== null)
}

export function searchWorkLogs(keyword: string, limit = 200, tagPath?: string, projectPublicId?: string): WorkLog[] {
  const workspaceId = getDefaultWorkspaceContext().workspace_id
  const tagFilter = buildWorkLogTagFilter(tagPath)
  const projectFilter = buildWorkLogProjectFilter(projectPublicId)
  const likeRows = (): Array<{ public_id: string }> => db.prepare(
    `SELECT work_logs.public_id
     FROM work_logs
     WHERE work_logs.workspace_id = ? AND work_logs.deleted_at IS NULL
     ${tagFilter.sql}
     ${projectFilter.sql}
       AND work_logs.content LIKE ? ESCAPE '!'
     ORDER BY work_logs.created_at DESC LIMIT ?`
  ).all(workspaceId, ...tagFilter.params, ...projectFilter.params, `%${escapeLikePattern(keyword)}%`, limit) as Array<{ public_id: string }>

  let rows: Array<{ public_id: string }>
  if (!keyword.trim()) {
    rows = likeRows()
  } else {
    try {
      rows = db.prepare(`
        SELECT work_logs.public_id
        FROM work_logs
        WHERE work_logs.workspace_id = ? AND work_logs.deleted_at IS NULL
          ${tagFilter.sql}
          ${projectFilter.sql}
          AND EXISTS (
            SELECT 1 FROM content_search
            WHERE content_search MATCH ?
              AND content_search.entity_type = 'work_log'
              AND content_search.entity_id = CAST(work_logs.id AS TEXT)
              AND content_search.workspace_id = work_logs.workspace_id
          )
        ORDER BY work_logs.created_at DESC
        LIMIT ?
      `).all(workspaceId, ...tagFilter.params, ...projectFilter.params, buildFtsQuery(keyword), limit) as Array<{ public_id: string }>
      if (rows.length === 0) rows = likeRows()
    } catch {
      rows = likeRows()
    }
  }
  return rows.map((row) => getWorkLogById(row.public_id, workspaceId)).filter((row): row is WorkLog => row !== null)
}

export function workLogExists(content: string, category: string, dateStr?: string): boolean {
  const workspaceId = getDefaultWorkspaceContext().workspace_id
  if (dateStr) {
    const bounds = getLocalDayBounds(dateStr)
    if (!bounds) return false
    const stmt = db.prepare(
      'SELECT 1 FROM work_logs WHERE workspace_id = ? AND deleted_at IS NULL AND content = ? AND category = ? AND created_at >= ? AND created_at < ? LIMIT 1'
    )
    return !!stmt.get(workspaceId, content, category, bounds.fromUtc, bounds.toUtc)
  }
  const stmt = db.prepare(
    'SELECT 1 FROM work_logs WHERE workspace_id = ? AND deleted_at IS NULL AND content = ? AND category = ? LIMIT 1'
  )
  return !!stmt.get(workspaceId, content, category)
}

export function deleteWorkLog(id: number): boolean {
  const metadata = getWriteMetadata()
  const workspaceId = metadata.workspaceId
  const now = metadata.timestamp
  return db.transaction(() => {
    const row = db.prepare('SELECT public_id, content, category FROM work_logs WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL').get(id, workspaceId) as { public_id: string; content: string; category: string } | undefined
    if (!row) return false
    const result = db.prepare('UPDATE work_logs SET deleted_at = ?, updated_at = ?, updated_by = ? WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL').run(now, now, metadata.userId, id, workspaceId)
    if (result.changes > 0) {
      enqueueEntitySync('work_log', row.public_id, { public_id: row.public_id, content: row.content, category: row.category, deleted_at: now }, workspaceId, now, 'delete')
      cleanupUnusedTags(workspaceId, now)
    }
    return result.changes > 0
  })()
}

export function restoreWorkLog(log: Pick<WorkLog, 'content' | 'category' | 'created_at' | 'task_id' | 'project_id' | 'tag_names'> & Partial<Pick<WorkLog, 'id' | 'public_id'>>): WorkLog {
  const metadata = getWriteMetadata()
  if (log.id !== undefined) {
    const logId = log.id
    const restored = db.transaction(() => {
      const result = db.prepare('UPDATE work_logs SET deleted_at = NULL, updated_at = ?, updated_by = ? WHERE id = ? AND workspace_id = ? AND deleted_at IS NOT NULL').run(metadata.timestamp, metadata.userId, logId, metadata.workspaceId)
      if (!result.changes) return null
      restoreEntityTags('work_log_tags', 'work_log_id', logId, metadata.workspaceId, metadata.timestamp)
      const row = db.prepare('SELECT public_id FROM work_logs WHERE id = ? AND workspace_id = ?').get(logId, metadata.workspaceId) as { public_id: string }
      enqueueEntitySync('work_log', row.public_id, { deleted_at: null }, metadata.workspaceId, metadata.timestamp)
      return row.public_id
    })()
    const publicId = restored ?? log.public_id
    if (publicId) return getWorkLogByPublicId(publicId) ?? addWorkLog(log.content, log.category, log.task_id, log.created_at, { projectId: log.project_id, tagNames: log.tag_names })
  }
  return addWorkLog(log.content, log.category, log.task_id, log.created_at, { projectId: log.project_id, tagNames: log.tag_names })
}

// --- Reports CRUD ---

export interface Report {
  id: number
  type: string
  date_from: string
  date_to: string
  content: string
  generated_at: string
}

export function saveReport(
  type: string,
  dateFrom: string,
  dateTo: string,
  content: string
): Report {
  const metadata = getWriteMetadata()
  const stmt = db.prepare(
    `INSERT INTO reports (
      type, date_from, date_to, content, generated_at, created_at, updated_at,
      public_id, workspace_id, created_by, updated_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`
  )
  return stmt.get(
    type,
    dateFrom,
    dateTo,
    content,
    metadata.timestamp,
    metadata.timestamp,
    metadata.timestamp,
    metadata.publicId,
    metadata.workspaceId,
    metadata.userId,
    metadata.userId
  ) as Report
}

export function getReports(limit = 50): Report[] {
  const stmt = db.prepare('SELECT * FROM reports ORDER BY generated_at DESC LIMIT ?')
  return stmt.all(limit) as Report[]
}

export function updateReportContent(id: number, content: string): Report | null {
  const metadata = getWriteMetadata()
  return db.prepare(
    'UPDATE reports SET content = ?, updated_at = ?, updated_by = ? WHERE id = ? RETURNING *'
  ).get(content, metadata.timestamp, metadata.userId, id) as Report | null
}

// --- Tasks CRUD ---

export interface Task {
  id: number
  public_id: string
  title: string
  description: string
  status: 'todo' | 'in_progress' | 'done' | 'draft'
  board_column: string
  position: number
  created_at: string
  updated_at: string
  completed_at: string | null
  due_date: string | null
  priority: TaskPriority
  checklist: TaskChecklistItem[]
  project_id: string | null
  tag_names: string[]
}

export function addTask(title: string, description = '', status: 'todo' | 'draft' = 'todo', createdAt?: string, associations: WorkItemAssociations = {}, priority: TaskPriority = 'medium', dueDate?: string | null, checklist: TaskChecklistItem[] = []): Task {
  const metadata = getWriteMetadata(createdAt)
  const create = db.transaction(() => {
    const maxPos = db.prepare(
      'SELECT COALESCE(MAX(position), -1) + 1 as next FROM tasks WHERE workspace_id = ? AND deleted_at IS NULL AND status = ?'
    ).get(metadata.workspaceId, status) as { next: number }

    const projectId = resolveProjectId(associations.projectId, metadata.workspaceId)
    const normalizedPriority = isTaskPriority(priority) ? priority : 'medium'
    const result = db.prepare(
      `INSERT INTO tasks (
        title, description, status, board_column, position, project_id, created_at, updated_at,
        public_id, workspace_id, created_by, updated_by, priority, checklist, due_date
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      title,
      description,
      status,
      status,
      maxPos.next,
      projectId ?? null,
      metadata.timestamp,
      metadata.timestamp,
      metadata.publicId,
      metadata.workspaceId,
      metadata.userId,
      metadata.userId,
      normalizedPriority,
      JSON.stringify(normalizeChecklist(checklist)),
      dueDate ?? null
    )
    setEntityTags('task_tags', 'task_id', Number(result.lastInsertRowid), metadata.publicId, associations.tagNames, metadata.workspaceId, metadata.userId, metadata.timestamp)
    enqueueEntitySync('task', metadata.publicId, { title, description, status, board_column: status, ...associationPatch(associations), due_date: dueDate ?? null, priority: normalizedPriority, checklist: normalizeChecklist(checklist) }, metadata.workspaceId, metadata.timestamp, 'create')
    return metadata.publicId
  })
  return getTaskByPublicId(create())!
}

export function getTaskByPublicId(publicId: string): Task | null {
  return getTaskRow(getDefaultWorkspaceContext().workspace_id, 'tasks.public_id = ?', publicId)
}

function getTaskById(workspaceId: number, id: number): Task | null {
  return getTaskRow(workspaceId, 'tasks.id = ?', id)
}

function getTaskRow(workspaceId: number, identityCondition: string, identityValue: string | number): Task | null {
  const row = db.prepare(`
    SELECT tasks.id, tasks.public_id, tasks.title, tasks.description, tasks.status, tasks.board_column,
      tasks.position, tasks.created_at, tasks.updated_at, tasks.completed_at, tasks.due_date,
      tasks.priority, tasks.checklist,
      projects.public_id AS project_public_id
    FROM tasks
    LEFT JOIN projects ON projects.id = tasks.project_id AND projects.workspace_id = tasks.workspace_id AND projects.deleted_at IS NULL
    WHERE tasks.workspace_id = ? AND ${identityCondition} AND tasks.deleted_at IS NULL
  `).get(workspaceId, identityValue) as TaskRow | undefined
  return row ? toTask(row) : null
}

interface TaskRow {
  id: number
  public_id: string
  title: string
  description: string
  status: Task['status']
  board_column: string
  position: number
  created_at: string
  updated_at: string
  completed_at: string | null
  due_date: string | null
  priority: string | null
  checklist: string | null
  project_public_id: string | null
}

function toTask(row: TaskRow, names?: string[]): Task {
  return { id: row.id, public_id: row.public_id, title: row.title, description: row.description, status: row.status, board_column: row.board_column, position: row.position, created_at: row.created_at, updated_at: row.updated_at, completed_at: row.completed_at, due_date: row.due_date, priority: isTaskPriority(row.priority) ? row.priority : 'medium', checklist: parseChecklist(row.checklist), project_id: row.project_public_id, tag_names: names ?? tagNames('task_tags', 'task_id', row.id) }
}

export function getTasks(): Task[] {
  const workspaceId = getDefaultWorkspaceContext().workspace_id
  const rows = db.prepare(`
    SELECT tasks.id, tasks.public_id, tasks.title, tasks.description, tasks.status, tasks.board_column,
      tasks.position, tasks.created_at, tasks.updated_at, tasks.completed_at, tasks.due_date,
      tasks.priority, tasks.checklist, projects.public_id AS project_public_id
    FROM tasks
    LEFT JOIN projects ON projects.id = tasks.project_id AND projects.workspace_id = tasks.workspace_id AND projects.deleted_at IS NULL
    WHERE tasks.workspace_id = ? AND tasks.deleted_at IS NULL
    ORDER BY tasks.board_column ASC, tasks.position ASC, tasks.id ASC
  `).all(workspaceId) as TaskRow[]
  const tagRows = db.prepare(`
    SELECT task_tags.task_id AS entity_id, COALESCE(tags.display_path, tags.path) AS name
    FROM task_tags
    INNER JOIN tags ON tags.id = task_tags.tag_id AND tags.workspace_id = ? AND tags.deleted_at IS NULL
    INNER JOIN tasks ON tasks.id = task_tags.task_id AND tasks.workspace_id = ? AND tasks.deleted_at IS NULL
  `).all(workspaceId, workspaceId) as Array<{ entity_id: number; name: string }>
  const tagsByTask = new Map<number, string[]>()
  for (const tag of tagRows) tagsByTask.set(tag.entity_id, [...(tagsByTask.get(tag.entity_id) ?? []), tag.name])
  return rows.map((row) => toTask(row, tagsByTask.get(row.id) ?? []))
}

export function updateTask(
  id: number,
  updates: Partial<Pick<Task, 'title' | 'description' | 'status' | 'board_column' | 'position' | 'due_date' | 'priority' | 'checklist' | 'project_id' | 'tag_names'>>
): Task | null {
  const metadata = getWriteMetadata()
  const update = db.transaction(() => {
    const fields: string[] = []
    const values: unknown[] = []
    const projectId = resolveProjectId(updates.project_id, metadata.workspaceId)

    if (updates.title !== undefined) { fields.push('title = ?'); values.push(updates.title) }
    if (updates.description !== undefined) { fields.push('description = ?'); values.push(updates.description) }
    if (updates.board_column !== undefined) {
      assertBoardColumn(updates.board_column, metadata.workspaceId)
      const boardState = normalizeTaskBoardState(updates.board_column, updates.status)
      fields.push('board_column = ?', 'status = ?')
      values.push(boardState.boardColumn, boardState.status)
      if (boardState.status === 'done') { fields.push('completed_at = ?'); values.push(metadata.timestamp) }
      else fields.push('completed_at = NULL')
    } else if (updates.status !== undefined) {
      assertTaskStatus(updates.status)
      fields.push('board_column = ?', 'status = ?')
      values.push(updates.status, updates.status)
      if (updates.status === 'done') { fields.push('completed_at = ?'); values.push(metadata.timestamp) }
      else fields.push('completed_at = NULL')
    }
    if (updates.position !== undefined) { fields.push('position = ?'); values.push(updates.position) }
    if (updates.due_date !== undefined) { fields.push('due_date = ?'); values.push(updates.due_date) }
    if (updates.priority !== undefined) {
      if (!isTaskPriority(updates.priority)) throw new Error('Task priority is invalid')
      fields.push('priority = ?')
      values.push(updates.priority)
    }
    if (updates.checklist !== undefined) {
      fields.push('checklist = ?')
      values.push(JSON.stringify(normalizeChecklist(updates.checklist)))
    }
    if (updates.project_id !== undefined) { fields.push('project_id = ?'); values.push(projectId ?? null) }

    fields.push('updated_at = ?', 'updated_by = ?')
    values.push(metadata.timestamp, metadata.userId)
    db.prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`).run(...values, id, metadata.workspaceId)
    const row = db.prepare('SELECT public_id FROM tasks WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL').get(id, metadata.workspaceId) as { public_id: string } | undefined
    if (!row) return null
    setEntityTags('task_tags', 'task_id', id, row.public_id, updates.tag_names, metadata.workspaceId, metadata.userId, metadata.timestamp)
    const patch: Record<string, unknown> = {}
    for (const key of ['title', 'description', 'status', 'board_column', 'position', 'due_date', 'priority', 'checklist'] as const) {
      if (updates[key] !== undefined) patch[key] = updates[key]
    }
    if (updates.project_id !== undefined) patch.project_id = updates.project_id
    if (updates.tag_names !== undefined) patch.tag_names = updates.tag_names
    enqueueEntitySync('task', row.public_id, patch, metadata.workspaceId, metadata.timestamp)
    return row.public_id
  })
  const publicId = update()
  return publicId ? getTaskByPublicId(publicId) : null
}

export function deleteTask(id: number): boolean {
  const metadata = getWriteMetadata()
  return db.transaction(() => {
    const row = db.prepare('SELECT public_id, title FROM tasks WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL').get(id, metadata.workspaceId) as { public_id: string; title: string } | undefined
    if (!row) return false
    const deleted = db.prepare('UPDATE tasks SET deleted_at = ?, updated_at = ?, updated_by = ? WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL').run(metadata.timestamp, metadata.timestamp, metadata.userId, id, metadata.workspaceId).changes > 0
    if (deleted) {
      enqueueEntitySync('task', row.public_id, { public_id: row.public_id, title: row.title, deleted_at: metadata.timestamp }, metadata.workspaceId, metadata.timestamp, 'delete')
      cleanupUnusedTags(metadata.workspaceId, metadata.timestamp)
    }
    return deleted
  })()
}

export function restoreTask(id: number): Task | null {
  const metadata = getWriteMetadata()
  const restored = db.transaction(() => {
    const result = db.prepare('UPDATE tasks SET deleted_at = NULL, updated_at = ?, updated_by = ? WHERE id = ? AND workspace_id = ? AND deleted_at IS NOT NULL').run(metadata.timestamp, metadata.userId, id, metadata.workspaceId)
    if (result.changes > 0) {
      restoreEntityTags('task_tags', 'task_id', id, metadata.workspaceId, metadata.timestamp)
      const row = db.prepare('SELECT public_id FROM tasks WHERE id = ? AND workspace_id = ?').get(id, metadata.workspaceId) as { public_id: string }
      enqueueEntitySync('task', row.public_id, { deleted_at: null }, metadata.workspaceId, metadata.timestamp)
    }
    return result.changes > 0
  })()
  return restored ? getTaskById(metadata.workspaceId, id) : null
}

export function reorderTasks(
  taskIds: number[],
  boardColumn: string,
  status?: Task['status'],
  sourceBoardColumn?: string,
  sourceTaskIds: number[] = [],
  sourceStatus?: Task['status']
): void {
  const metadata = getWriteMetadata()
  assertBoardColumn(boardColumn, metadata.workspaceId)
  const targetState = normalizeTaskBoardState(boardColumn, status)
  if (sourceBoardColumn) assertBoardColumn(sourceBoardColumn, metadata.workspaceId)
  const sourceState = sourceBoardColumn ? normalizeTaskBoardState(sourceBoardColumn, sourceStatus) : undefined
  const stmt = db.prepare(`
    UPDATE tasks
    SET
      position = ?,
      board_column = ?,
      status = ?,
      updated_at = ?,
      updated_by = ?,
      completed_at = ?
    WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL
  `)
  const tx = db.transaction((groups: Array<{ ids: number[]; column: string; taskStatus: Task['status'] }>) => {
    groups.forEach(({ ids, column, taskStatus }) => ids.forEach((id, index) => {
      const current = db.prepare('SELECT completed_at FROM tasks WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL').get(id, metadata.workspaceId) as { completed_at: string | null } | undefined
      const completedAt = taskStatus === 'done' ? current?.completed_at ?? metadata.timestamp : null
      const result = stmt.run(index, column, taskStatus, metadata.timestamp, metadata.userId, completedAt, id, metadata.workspaceId)
      if (result.changes > 0) {
        const row = db.prepare('SELECT public_id FROM tasks WHERE id = ? AND workspace_id = ?').get(id, metadata.workspaceId) as { public_id: string }
        enqueueEntitySync('task', row.public_id, { board_column: column, status: taskStatus, position: index }, metadata.workspaceId, metadata.timestamp)
      }
    }))
  })
  const groups = [{ ids: taskIds, column: targetState.boardColumn, taskStatus: targetState.status }]
  if (sourceBoardColumn && sourceBoardColumn !== boardColumn) {
    groups.push({ ids: sourceTaskIds, column: sourceState!.boardColumn, taskStatus: sourceState!.status })
  }
  tx(groups)
}

function assertBoardColumn(column: string, workspaceId: number): void {
  if (column === 'draft') return
  const exists = db.prepare('SELECT 1 FROM kanban_columns WHERE workspace_id = ? AND column_key = ?').get(workspaceId, column)
  if (!exists) throw new Error('Kanban column is invalid')
}

function assertTaskStatus(status: string): asserts status is Task['status'] {
  if (!['todo', 'in_progress', 'done', 'draft'].includes(status)) throw new Error('Task status is invalid')
}

export function completeTask(id: number, logContent: string): Task | null {
  const metadata = getWriteMetadata()
  const publicId = db.transaction(() => {
    const updated = db.prepare(`UPDATE tasks SET status = 'done', board_column = 'done', completed_at = COALESCE(completed_at, ?), updated_at = ?, updated_by = ? WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`).run(metadata.timestamp, metadata.timestamp, metadata.userId, id, metadata.workspaceId)
    if (!updated.changes) return null
    const task = db.prepare('SELECT public_id FROM tasks WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL').get(id, metadata.workspaceId) as { public_id: string }
    if (logContent.trim()) insertWorkLog({ content: logContent.trim(), category: '', taskId: id }, { ...metadata, publicId: randomUUID() })
    enqueueEntitySync('task', task.public_id, { status: 'done', board_column: 'done', completed_at: metadata.timestamp }, metadata.workspaceId, metadata.timestamp)
    return task.public_id
  })()
  return publicId ? getTaskByPublicId(publicId) : null
}

export interface KanbanColumn {
  public_id: string
  column_key: string
  name: string
  status: Exclude<Task['status'], 'draft'>
  position: number
  is_system: boolean
}

export function getKanbanColumns(): KanbanColumn[] {
  const workspaceId = getDefaultWorkspaceContext().workspace_id
  const rows = db.prepare(`
    SELECT public_id, column_key, name, status, position, is_system
    FROM kanban_columns
    WHERE workspace_id = ?
    ORDER BY position ASC, id ASC
  `).all(workspaceId) as Array<Omit<KanbanColumn, 'is_system'> & { is_system: number }>
  return rows.map((row) => ({ ...row, is_system: row.is_system === 1 }))
}

export function createKanbanColumn(name: string): KanbanColumn {
  const normalizedName = name.trim()
  if (!normalizedName) throw new Error('Kanban column name is required')
  const metadata = getWriteMetadata()
  const columnKey = `custom_${randomUUID()}`
  const publicId = randomUUID()
  const position = (db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM kanban_columns WHERE workspace_id = ?').get(metadata.workspaceId) as { next: number }).next
  db.transaction(() => {
    db.prepare(`
      INSERT INTO kanban_columns (public_id, workspace_id, column_key, name, status, position, is_system, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'in_progress', ?, 0, ?, ?)
    `).run(publicId, metadata.workspaceId, columnKey, normalizedName, position, metadata.timestamp, metadata.timestamp)
    enqueueEntitySync('kanban_column', publicId, { public_id: publicId, column_key: columnKey, name: normalizedName, status: 'in_progress', position }, metadata.workspaceId, metadata.timestamp, 'create')
  })()
  return getKanbanColumns().find((column) => column.column_key === columnKey)!
}

export function updateKanbanColumn(publicId: string, name: string): KanbanColumn | null {
  const normalizedName = name.trim()
  if (!normalizedName) throw new Error('Kanban column name is required')
  const metadata = getWriteMetadata()
  const updated = db.transaction(() => {
    const column = db.prepare('SELECT column_key, status, position FROM kanban_columns WHERE public_id = ? AND workspace_id = ? AND is_system = 0').get(publicId, metadata.workspaceId) as { column_key: string; status: KanbanColumn['status']; position: number } | undefined
    if (!column) return false
    db.prepare('UPDATE kanban_columns SET name = ?, updated_at = ? WHERE public_id = ? AND workspace_id = ? AND is_system = 0').run(normalizedName, metadata.timestamp, publicId, metadata.workspaceId)
    enqueueEntitySync('kanban_column', publicId, { public_id: publicId, column_key: column.column_key, name: normalizedName, status: column.status, position: column.position }, metadata.workspaceId, metadata.timestamp)
    return true
  })()
  if (!updated) return null
  return getKanbanColumns().find((column) => column.public_id === publicId) ?? null
}

export function deleteKanbanColumn(publicId: string): boolean {
  const metadata = getWriteMetadata()
  return db.transaction(() => {
    const column = db.prepare('SELECT column_key, is_system FROM kanban_columns WHERE public_id = ? AND workspace_id = ?').get(publicId, metadata.workspaceId) as { column_key: string; is_system: number } | undefined
    if (!column || column.is_system === 1) return false
    const tasks = db.prepare('SELECT public_id FROM tasks WHERE workspace_id = ? AND board_column = ? AND deleted_at IS NULL').all(metadata.workspaceId, column.column_key) as Array<{ public_id: string }>
    db.prepare("UPDATE tasks SET board_column = 'todo', status = 'todo', updated_at = ?, updated_by = ? WHERE workspace_id = ? AND board_column = ? AND deleted_at IS NULL").run(metadata.timestamp, metadata.userId, metadata.workspaceId, column.column_key)
    tasks.forEach((task) => enqueueEntitySync('task', task.public_id, { board_column: 'todo', status: 'todo' }, metadata.workspaceId, metadata.timestamp))
    const deleted = db.prepare('DELETE FROM kanban_columns WHERE public_id = ? AND workspace_id = ? AND is_system = 0').run(publicId, metadata.workspaceId).changes > 0
    if (deleted) enqueueEntitySync('kanban_column', publicId, { public_id: publicId, column_key: column.column_key, deleted_at: metadata.timestamp }, metadata.workspaceId, metadata.timestamp, 'delete')
    return deleted
  })()
}

// --- Settings CRUD ---

export interface DailyStats {
  date: string
  log_count: number
  task_completed: number
}

export function getStats(days = DEFAULT_STATS_DAYS, context: WorkspaceContext = getDefaultWorkspaceContext()): {
  daily: DailyStats[]
  totalLogs: number
  totalTasksDone: number
  totalTasksActive: number
  streak: number
} {
  const validatedDays = assertStatsDays(days)
  const localStart = new Date()
  localStart.setHours(0, 0, 0, 0)
  localStart.setDate(localStart.getDate() - validatedDays)
  const fromUtc = localStart.toISOString()
  const dailyMap = new Map<string, DailyStats>()
  const logDates = new Set<string>()
  const localDate = (value: string): string => formatLocalDate(new Date(value))
  const logs = db.prepare('SELECT created_at FROM work_logs WHERE workspace_id = ? AND deleted_at IS NULL AND created_at >= ?').all(context.workspace_id, fromUtc) as Array<{ created_at: string }>
  logs.forEach((log) => {
    const date = localDate(log.created_at)
    logDates.add(date)
    const current = dailyMap.get(date) ?? { date, log_count: 0, task_completed: 0 }
    current.log_count++
    dailyMap.set(date, current)
  })

  // Merge completed tasks per day
  const taskDone = db.prepare(`
    SELECT completed_at
    FROM tasks
    WHERE workspace_id = ? AND deleted_at IS NULL AND completed_at IS NOT NULL AND completed_at >= ?
  `).all(context.workspace_id, fromUtc) as Array<{ completed_at: string }>
  taskDone.forEach((task) => {
    const date = localDate(task.completed_at)
    const current = dailyMap.get(date) ?? { date, log_count: 0, task_completed: 0 }
    current.task_completed++
    dailyMap.set(date, current)
  })
  const daily: DailyStats[] = []
  dailyMap.forEach((value) => daily.push(value))
  daily.sort((a, b) => a.date.localeCompare(b.date))

  const totalLogs = (db.prepare('SELECT COUNT(*) as c FROM work_logs WHERE workspace_id = ? AND deleted_at IS NULL').get(context.workspace_id) as { c: number }).c
  const totalTasksDone = (db.prepare("SELECT COUNT(*) as c FROM tasks WHERE workspace_id = ? AND deleted_at IS NULL AND status = 'done'").get(context.workspace_id) as { c: number }).c
  const totalTasksActive = (db.prepare("SELECT COUNT(*) as c FROM tasks WHERE workspace_id = ? AND deleted_at IS NULL AND status IN ('todo', 'in_progress')").get(context.workspace_id) as { c: number }).c

  // Calculate streak (consecutive days with logs ending today or yesterday)
  let streak = 0
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  for (let i = 0; i <= validatedDays; i++) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const dateStr = formatLocalDate(d)
    if (logDates.has(dateStr)) {
      streak++
    } else if (i === 0) {
      // Today has no logs yet, that's ok, check from yesterday
      continue
    } else {
      break
    }
  }

  return { daily, totalLogs, totalTasksDone, totalTasksActive, streak }
}

export function getAllWorkLogs(): WorkLog[] {
  const workspaceId = getDefaultWorkspaceContext().workspace_id
  const rows = db.prepare(`
    SELECT work_logs.id, work_logs.public_id, work_logs.content, work_logs.category, work_logs.created_at, work_logs.task_id,
      projects.public_id AS project_public_id
    FROM work_logs
    LEFT JOIN projects ON projects.id = work_logs.project_id AND projects.workspace_id = work_logs.workspace_id AND projects.deleted_at IS NULL
    WHERE work_logs.workspace_id = ? AND work_logs.deleted_at IS NULL
    ORDER BY work_logs.created_at DESC, work_logs.id DESC
  `).all(workspaceId) as WorkLogRow[]
  const tagRows = db.prepare(`
    SELECT work_log_tags.work_log_id AS entity_id, COALESCE(tags.display_path, tags.path) AS name
    FROM work_log_tags
    INNER JOIN tags ON tags.id = work_log_tags.tag_id AND tags.workspace_id = ? AND tags.deleted_at IS NULL
    INNER JOIN work_logs ON work_logs.id = work_log_tags.work_log_id AND work_logs.workspace_id = ? AND work_logs.deleted_at IS NULL
  `).all(workspaceId, workspaceId) as Array<{ entity_id: number; name: string }>
  const tagsByLog = new Map<number, string[]>()
  for (const tag of tagRows) tagsByLog.set(tag.entity_id, [...(tagsByLog.get(tag.entity_id) ?? []), tag.name])
  return rows.map((row) => toWorkLog(row, tagsByLog.get(row.id) ?? []))
}

export function getCategories(): string[] {
  const workspaceId = getDefaultWorkspaceContext().workspace_id
  const rows = db.prepare(
    "SELECT DISTINCT category FROM work_logs WHERE workspace_id = ? AND deleted_at IS NULL AND category != '' ORDER BY category"
  ).all(workspaceId) as { category: string }[]
  return rows.map((r) => r.category)
}

export function updateWorkLogCategory(id: number, category: string): void {
  const metadata = getWriteMetadata()
  const update = db.prepare('UPDATE work_logs SET category = ?, updated_at = ?, updated_by = ? WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL')
    .run(category, metadata.timestamp, metadata.userId, id, metadata.workspaceId)
  if (update.changes > 0) {
    const row = db.prepare('SELECT public_id FROM work_logs WHERE id = ? AND workspace_id = ?').get(id, metadata.workspaceId) as { public_id: string }
    enqueueEntitySync('work_log', row.public_id, { category }, metadata.workspaceId, metadata.timestamp)
  }
}

export function updateWorkLog(id: number, content: string, category: string, created_at?: string, associations: WorkItemAssociations = {}): WorkLog | null {
  const metadata = getWriteMetadata(created_at)
  const update = db.transaction(() => {
    const fields = ['content = ?', 'category = ?']
    const values: unknown[] = [content, category]
    if (created_at) { fields.push('created_at = ?'); values.push(created_at) }
    if (associations.projectId !== undefined) {
      fields.push('project_id = ?')
      values.push(resolveProjectId(associations.projectId, metadata.workspaceId) ?? null)
    }
    fields.push('updated_at = ?', 'updated_by = ?')
    values.push(metadata.timestamp, metadata.userId)
    db.prepare(`UPDATE work_logs SET ${fields.join(', ')} WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`).run(...values, id, metadata.workspaceId)
    const row = db.prepare('SELECT public_id FROM work_logs WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL').get(id, metadata.workspaceId) as { public_id: string } | undefined
    if (!row) return null
    setEntityTags('work_log_tags', 'work_log_id', id, row.public_id, associations.tagNames, metadata.workspaceId, metadata.userId, metadata.timestamp)
    enqueueEntitySync('work_log', row.public_id, { content, category, ...associationPatch(associations) }, metadata.workspaceId, metadata.timestamp)
    return row.public_id
  })
  const publicId = update()
  return publicId ? getWorkLogByPublicId(publicId) : null
}

export function getSetting(key: string): string | null {
  const stmt = db.prepare('SELECT value FROM settings WHERE key = ?')
  const row = stmt.get(key) as { value: string } | undefined
  return row?.value ?? null
}

export function setSetting(key: string, value: string): void {
  const metadata = getWriteMetadata()
  const stmt = db.prepare(
    `INSERT INTO settings (
      key, value, public_id, workspace_id, created_by, updated_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at`
  )
  stmt.run(
    key,
    value,
    metadata.publicId,
    metadata.workspaceId,
    metadata.userId,
    metadata.userId,
    metadata.timestamp,
    metadata.timestamp
  )
}

export function deleteSetting(key: string): void {
  const stmt = db.prepare('DELETE FROM settings WHERE key = ?')
  stmt.run(key)
}

import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import { randomUUID } from 'node:crypto'

import { backupDatabase, getDatabaseVersion, initializeDatabase, runMigrations } from './database/connection'
import type { WorkspaceContext } from './repositories/contracts'
import { normalizeTagName } from './repositories/localTagRepository'

let db: Database.Database

const DB_NAME = 'workpulse.db'

function formatLocalDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
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
    },
    (database) => runMigrations(database)
  )

  if (!runIntegrityCheck()) {
    throw new Error('Database integrity check failed')
  }
}

export function getDatabase(): Database.Database {
  return db
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

// --- Work Logs CRUD ---

export interface WorkLog {
  id: number
  public_id: string
  content: string
  category: string
  created_at: string
  task_id: number | null
  project_id: string | null
  repository_id: string | null
  tag_names: string[]
}

export interface WorkItemAssociations {
  projectId?: string | null
  repositoryId?: string | null
  tagNames?: string[]
}

function resolveAssociationId(table: 'projects' | 'repositories', publicId: string | null | undefined, workspaceId: number): number | null | undefined {
  if (publicId === undefined) return undefined
  if (publicId === null) return null
  const row = db.prepare(`SELECT id FROM ${table} WHERE workspace_id = ? AND public_id = ? AND deleted_at IS NULL`).get(workspaceId, publicId) as { id: number } | undefined
  if (!row) throw new Error(`${table === 'projects' ? 'Project' : 'Repository'} not found`)
  return row.id
}

function ensureTagIds(names: string[], workspaceId: number, userId: number, now: string): number[] {
  const ids: number[] = []
  for (const rawName of Array.from(new Set(names.map((name) => normalizeTagName(name))))) {
    const existing = db.prepare('SELECT id FROM tags WHERE workspace_id = ? AND path = ?').get(workspaceId, rawName) as { id: number } | undefined
    let tagId = existing?.id
    if (!tagId) {
      const tag = db.prepare(`INSERT INTO tags (public_id, workspace_id, name, path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id, public_id`).get(randomUUID(), workspaceId, rawName, rawName, now, now) as { id: number; public_id: string }
      tagId = tag.id
      db.prepare(`INSERT INTO sync_operations (public_id, workspace_id, entity_type, entity_public_id, operation_type, payload, created_at, updated_at) VALUES (?, ?, 'tag', ?, 'create', ?, ?, ?)`).run(randomUUID(), workspaceId, tag.public_id, JSON.stringify({ public_id: tag.public_id, path: rawName }), now, now)
    }
    ids.push(tagId)
  }
  return ids
}

function setEntityTags(linkTable: 'work_log_tags' | 'task_tags', entityColumn: 'work_log_id' | 'task_id', entityId: number, entityPublicId: string, names: string[] | undefined, workspaceId: number, userId: number, now: string): void {
  if (names === undefined) return
  db.prepare(`DELETE FROM ${linkTable} WHERE ${entityColumn} = ?`).run(entityId)
  const tagIds = ensureTagIds(names, workspaceId, userId, now)
  const insert = db.prepare(`INSERT OR IGNORE INTO ${linkTable} (${entityColumn}, tag_id) VALUES (?, ?)`)
  for (const tagId of tagIds) insert.run(entityId, tagId)
  db.prepare(`INSERT INTO sync_operations (public_id, workspace_id, entity_type, entity_public_id, operation_type, payload, created_at, updated_at) VALUES (?, ?, ?, ?, 'update', ?, ?, ?)`).run(randomUUID(), workspaceId, linkTable, entityPublicId, JSON.stringify({ tag_names: names }), now, now)
}

function tagNames(linkTable: 'work_log_tags' | 'task_tags', entityColumn: 'work_log_id' | 'task_id', entityId: number): string[] {
  const rows = db.prepare(`SELECT tags.path FROM ${linkTable} INNER JOIN tags ON tags.id = ${linkTable}.tag_id WHERE ${linkTable}.${entityColumn} = ? AND tags.deleted_at IS NULL ORDER BY tags.path`).all(entityId) as Array<{ path: string }>
  return rows.map((row) => row.path)
}

function enqueueEntitySync(entityType: 'work_log' | 'task', entityPublicId: string, payload: unknown, workspaceId: number, now: string): void {
  db.prepare(`INSERT INTO sync_operations (public_id, workspace_id, entity_type, entity_public_id, operation_type, payload, created_at, updated_at) VALUES (?, ?, ?, ?, 'update', ?, ?, ?)`).run(randomUUID(), workspaceId, entityType, entityPublicId, JSON.stringify(payload), now, now)
}

function resolveWorkLogTaskId(taskId: number | null): number | null {
  if (taskId === null) return null
  const exists = db.prepare('SELECT 1 FROM tasks WHERE id = ?').get(taskId)
  return exists ? taskId : null
}

export function addWorkLog(
  content: string,
  category = '',
  taskId: number | null = null,
  createdAt?: string,
  associations: WorkItemAssociations = {}
): WorkLog {
  const resolvedTaskId = resolveWorkLogTaskId(taskId)
  const metadata = getWriteMetadata(createdAt)
  const projectId = resolveAssociationId('projects', associations.projectId, metadata.workspaceId)
  const repositoryId = resolveAssociationId('repositories', associations.repositoryId, metadata.workspaceId)
  const stmt = db.prepare(
    `INSERT INTO work_logs (
      content, category, task_id, project_id, repository_id, created_at, updated_at,
      public_id, workspace_id, created_by, updated_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  stmt.run(
    content,
    category,
    resolvedTaskId,
    projectId ?? null,
    repositoryId ?? null,
    metadata.timestamp,
    metadata.timestamp,
    metadata.publicId,
    metadata.workspaceId,
    metadata.userId,
    metadata.userId
  )
  setEntityTags('work_log_tags', 'work_log_id', Number((db.prepare('SELECT id FROM work_logs WHERE public_id = ?').get(metadata.publicId) as { id: number }).id), metadata.publicId, associations.tagNames, metadata.workspaceId, metadata.userId, metadata.timestamp)
  enqueueEntitySync('work_log', metadata.publicId, { project_id: associations.projectId ?? null, repository_id: associations.repositoryId ?? null, tag_names: associations.tagNames ?? [] }, metadata.workspaceId, metadata.timestamp)
  return getWorkLogById(metadata.publicId)!
}

function getWorkLogById(publicId: string): WorkLog | null {
  const row = db.prepare(`
    SELECT work_logs.id, work_logs.public_id, work_logs.content, work_logs.category, work_logs.created_at, work_logs.task_id,
      projects.public_id AS project_public_id, repositories.public_id AS repository_public_id
    FROM work_logs
    LEFT JOIN projects ON projects.id = work_logs.project_id AND projects.workspace_id = work_logs.workspace_id AND projects.deleted_at IS NULL
    LEFT JOIN repositories ON repositories.id = work_logs.repository_id AND repositories.workspace_id = work_logs.workspace_id AND repositories.deleted_at IS NULL
    WHERE work_logs.public_id = ? AND work_logs.deleted_at IS NULL
  `).get(publicId) as { id: number; public_id: string; content: string; category: string; created_at: string; task_id: number | null; project_public_id: string | null; repository_public_id: string | null } | undefined
  if (!row) return null
  return { id: row.id, public_id: row.public_id, content: row.content, category: row.category, created_at: row.created_at, task_id: row.task_id, project_id: row.project_public_id, repository_id: row.repository_public_id, tag_names: tagNames('work_log_tags', 'work_log_id', row.id) }
}

export function getWorkLogs(limit = 200, offset = 0): WorkLog[] {
  const rows = db.prepare('SELECT public_id FROM work_logs WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset) as Array<{ public_id: string }>
  return rows.map((row) => getWorkLogById(row.public_id)).filter((row): row is WorkLog => row !== null)
}

export function getWorkLogsByDateRange(from: string, to: string): WorkLog[] {
  const rows = db.prepare('SELECT public_id FROM work_logs WHERE deleted_at IS NULL AND date(created_at) >= date(?) AND date(created_at) <= date(?) ORDER BY created_at ASC').all(from, to) as Array<{ public_id: string }>
  return rows.map((row) => getWorkLogById(row.public_id)).filter((row): row is WorkLog => row !== null)
}

export function searchWorkLogs(keyword: string, limit = 200): WorkLog[] {
  const rows = db.prepare('SELECT public_id FROM work_logs WHERE deleted_at IS NULL AND content LIKE ? ORDER BY created_at DESC LIMIT ?').all(`%${keyword}%`, limit) as Array<{ public_id: string }>
  return rows.map((row) => getWorkLogById(row.public_id)).filter((row): row is WorkLog => row !== null)
}

export function workLogExists(content: string, category: string, dateStr?: string): boolean {
  if (dateStr) {
    const stmt = db.prepare(
      'SELECT 1 FROM work_logs WHERE content = ? AND category = ? AND date(created_at) = date(?) LIMIT 1'
    )
    return !!stmt.get(content, category, dateStr)
  }
  const stmt = db.prepare(
    'SELECT 1 FROM work_logs WHERE content = ? AND category = ? LIMIT 1'
  )
  return !!stmt.get(content, category)
}

export function deleteWorkLog(id: number): boolean {
  const stmt = db.prepare('DELETE FROM work_logs WHERE id = ?')
  const result = stmt.run(id)
  return result.changes > 0
}

export function restoreWorkLog(log: Pick<WorkLog, 'content' | 'category' | 'created_at' | 'task_id'>): WorkLog {
  return addWorkLog(log.content, log.category, log.task_id, log.created_at)
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
  project_id: string | null
  repository_id: string | null
  tag_names: string[]
}

export function addTask(title: string, description = '', status: 'todo' | 'draft' = 'todo', createdAt?: string, associations: WorkItemAssociations = {}): Task {
  const maxPos = db.prepare(
    'SELECT COALESCE(MAX(position), -1) + 1 as next FROM tasks WHERE status = ?'
  ).get(status) as { next: number }

  const metadata = getWriteMetadata(createdAt)
  const projectId = resolveAssociationId('projects', associations.projectId, metadata.workspaceId)
  const repositoryId = resolveAssociationId('repositories', associations.repositoryId, metadata.workspaceId)
  const stmt = db.prepare(
    `INSERT INTO tasks (
      title, description, status, board_column, position, project_id, repository_id, created_at, updated_at,
      public_id, workspace_id, created_by, updated_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  stmt.run(
    title,
    description,
    status,
    status,
    maxPos.next,
    projectId ?? null,
    repositoryId ?? null,
    metadata.timestamp,
    metadata.timestamp,
    metadata.publicId,
    metadata.workspaceId,
    metadata.userId,
    metadata.userId
  )
  const row = db.prepare('SELECT id, public_id FROM tasks WHERE public_id = ?').get(metadata.publicId) as { id: number; public_id: string }
  setEntityTags('task_tags', 'task_id', row.id, row.public_id, associations.tagNames, metadata.workspaceId, metadata.userId, metadata.timestamp)
  enqueueEntitySync('task', row.public_id, { project_id: associations.projectId ?? null, repository_id: associations.repositoryId ?? null, tag_names: associations.tagNames ?? [] }, metadata.workspaceId, metadata.timestamp)
  return getTaskById(row.id)!
}

export function getTasks(): Task[] {
  const rows = db.prepare('SELECT id FROM tasks WHERE deleted_at IS NULL ORDER BY position ASC').all() as Array<{ id: number }>
  return rows.map((row) => getTaskById(row.id)).filter((row): row is Task => row !== null)
}

function getTaskById(id: number): Task | null {
  const row = db.prepare(`
    SELECT tasks.id, tasks.public_id, tasks.title, tasks.description, tasks.status, tasks.board_column,
      tasks.position, tasks.created_at, tasks.updated_at, tasks.completed_at, tasks.due_date,
      projects.public_id AS project_public_id, repositories.public_id AS repository_public_id
    FROM tasks
    LEFT JOIN projects ON projects.id = tasks.project_id AND projects.workspace_id = tasks.workspace_id AND projects.deleted_at IS NULL
    LEFT JOIN repositories ON repositories.id = tasks.repository_id AND repositories.workspace_id = tasks.workspace_id AND repositories.deleted_at IS NULL
    WHERE tasks.id = ? AND tasks.deleted_at IS NULL
  `).get(id) as { id: number; public_id: string; title: string; description: string; status: Task['status']; board_column: string; position: number; created_at: string; updated_at: string; completed_at: string | null; due_date: string | null; project_public_id: string | null; repository_public_id: string | null } | undefined
  if (!row) return null
  return { id: row.id, public_id: row.public_id, title: row.title, description: row.description, status: row.status, board_column: row.board_column, position: row.position, created_at: row.created_at, updated_at: row.updated_at, completed_at: row.completed_at, due_date: row.due_date, project_id: row.project_public_id, repository_id: row.repository_public_id, tag_names: tagNames('task_tags', 'task_id', row.id) }
}

export function updateTask(
  id: number,
  updates: Partial<Pick<Task, 'title' | 'description' | 'status' | 'position' | 'due_date' | 'project_id' | 'repository_id' | 'tag_names'>>
): Task | null {
  const fields: string[] = []
  const values: unknown[] = []
  const metadata = getWriteMetadata()

  const projectId = resolveAssociationId('projects', updates.project_id, metadata.workspaceId)
  const repositoryId = resolveAssociationId('repositories', updates.repository_id, metadata.workspaceId)

  if (updates.title !== undefined) {
    fields.push('title = ?')
    values.push(updates.title)
  }
  if (updates.description !== undefined) {
    fields.push('description = ?')
    values.push(updates.description)
  }
  if (updates.status !== undefined) {
    fields.push('status = ?', 'board_column = ?')
    values.push(updates.status, updates.status)
    if (updates.status === 'done') {
      fields.push('completed_at = ?')
      values.push(metadata.timestamp)
    } else {
      fields.push('completed_at = NULL')
    }
  }
  if (updates.position !== undefined) {
    fields.push('position = ?')
    values.push(updates.position)
  }
  if (updates.due_date !== undefined) {
    fields.push('due_date = ?')
    values.push(updates.due_date)
  }
  if (updates.project_id !== undefined) {
    fields.push('project_id = ?')
    values.push(projectId ?? null)
  }
  if (updates.repository_id !== undefined) {
    fields.push('repository_id = ?')
    values.push(repositoryId ?? null)
  }

  fields.push('updated_at = ?', 'updated_by = ?')
  values.push(metadata.timestamp, metadata.userId)

  db.prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ? AND deleted_at IS NULL`).run(...values, id)
  const row = db.prepare('SELECT public_id FROM tasks WHERE id = ? AND deleted_at IS NULL').get(id) as { public_id: string } | undefined
  if (!row) return null
  setEntityTags('task_tags', 'task_id', id, row.public_id, updates.tag_names, metadata.workspaceId, metadata.userId, metadata.timestamp)
  enqueueEntitySync('task', row.public_id, { project_id: updates.project_id ?? null, repository_id: updates.repository_id ?? null, tag_names: updates.tag_names ?? [] }, metadata.workspaceId, metadata.timestamp)
  return getTaskById(id)
}

export function deleteTask(id: number): boolean {
  const stmt = db.prepare('DELETE FROM tasks WHERE id = ?')
  return stmt.run(id).changes > 0
}

export function reorderTasks(taskIds: number[], status: string): void {
  const metadata = getWriteMetadata()
  const stmt = db.prepare(`
    UPDATE tasks
    SET
      position = ?,
      board_column = ?,
      status = ?,
      updated_at = ?,
      updated_by = ?,
      completed_at = CASE
        WHEN ? = 'done' AND completed_at IS NULL THEN ?
        WHEN ? != 'done' THEN NULL
        ELSE completed_at
      END
    WHERE id = ?
  `)
  const tx = db.transaction((ids: number[]) => {
    ids.forEach((id, index) => {
      stmt.run(
        index,
        status,
        status,
        metadata.timestamp,
        metadata.userId,
        status,
        metadata.timestamp,
        status,
        id
      )
    })
  })
  tx(taskIds)
}

// --- Settings CRUD ---

export interface DailyStats {
  date: string
  log_count: number
  task_completed: number
}

export function getStats(days = 30): {
  daily: DailyStats[]
  totalLogs: number
  totalTasksDone: number
  totalTasksActive: number
  streak: number
} {
  const daily = db.prepare(`
    SELECT date(created_at) as date, COUNT(*) as log_count, 0 as task_completed
    FROM work_logs
    WHERE created_at >= datetime('now', '-${days} days', 'localtime')
    GROUP BY date(created_at)
    ORDER BY date ASC
  `).all() as DailyStats[]

  // Merge completed tasks per day
  const taskDone = db.prepare(`
    SELECT date(completed_at) as date, COUNT(*) as cnt
    FROM tasks
    WHERE completed_at IS NOT NULL AND completed_at >= datetime('now', '-${days} days', 'localtime')
    GROUP BY date(completed_at)
  `).all() as { date: string; cnt: number }[]

  const doneMap = new Map(taskDone.map((r) => [r.date, r.cnt]))
  for (const d of daily) {
    d.task_completed = doneMap.get(d.date) || 0
  }
  // Add days that only have completed tasks but no logs
  doneMap.forEach((cnt, date) => {
    if (!daily.find((d) => d.date === date)) {
      daily.push({ date, log_count: 0, task_completed: cnt })
    }
  })
  daily.sort((a, b) => a.date.localeCompare(b.date))

  const totalLogs = (db.prepare('SELECT COUNT(*) as c FROM work_logs').get() as { c: number }).c
  const totalTasksDone = (db.prepare("SELECT COUNT(*) as c FROM tasks WHERE status = 'done'").get() as { c: number }).c
  const totalTasksActive = (db.prepare("SELECT COUNT(*) as c FROM tasks WHERE status IN ('todo', 'in_progress')").get() as { c: number }).c

  // Calculate streak (consecutive days with logs ending today or yesterday)
  let streak = 0
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const logDates = new Set(daily.map((d) => d.date))
  for (let i = 0; i <= days; i++) {
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
  const rows = db.prepare('SELECT public_id FROM work_logs WHERE deleted_at IS NULL ORDER BY created_at DESC').all() as Array<{ public_id: string }>
  return rows.map((row) => getWorkLogById(row.public_id)).filter((row): row is WorkLog => row !== null)
}

export function getCategories(): string[] {
  const rows = db.prepare(
    "SELECT DISTINCT category FROM work_logs WHERE category != '' ORDER BY category"
  ).all() as { category: string }[]
  return rows.map((r) => r.category)
}

export function updateWorkLogCategory(id: number, category: string): void {
  const metadata = getWriteMetadata()
  db.prepare('UPDATE work_logs SET category = ?, updated_at = ?, updated_by = ? WHERE id = ?')
    .run(category, metadata.timestamp, metadata.userId, id)
}

export function updateWorkLog(id: number, content: string, category: string, created_at?: string, associations: WorkItemAssociations = {}): WorkLog | null {
  const metadata = getWriteMetadata(created_at)
  const projectId = resolveAssociationId('projects', associations.projectId, metadata.workspaceId)
  const repositoryId = resolveAssociationId('repositories', associations.repositoryId, metadata.workspaceId)
  const fields = ['content = ?', 'category = ?', 'project_id = ?', 'repository_id = ?', 'updated_at = ?', 'updated_by = ?']
  const values: unknown[] = [content, category, projectId ?? null, repositoryId ?? null, metadata.timestamp, metadata.userId]
  if (created_at) {
    fields.splice(4, 0, 'created_at = ?')
    values.splice(4, 0, metadata.timestamp)
  }
  db.prepare(`UPDATE work_logs SET ${fields.join(', ')} WHERE id = ? AND deleted_at IS NULL`).run(...values, id)
  const row = db.prepare('SELECT public_id FROM work_logs WHERE id = ? AND deleted_at IS NULL').get(id) as { public_id: string } | undefined
  if (!row) return null
  setEntityTags('work_log_tags', 'work_log_id', id, row.public_id, associations.tagNames, metadata.workspaceId, metadata.userId, metadata.timestamp)
  enqueueEntitySync('work_log', row.public_id, { project_id: associations.projectId ?? null, repository_id: associations.repositoryId ?? null, tag_names: associations.tagNames ?? [] }, metadata.workspaceId, metadata.timestamp)
  return getWorkLogById(row.public_id)
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

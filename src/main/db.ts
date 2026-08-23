import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import { randomUUID } from 'node:crypto'

import { backupDatabase, getDatabaseVersion, initializeDatabase, runMigrations } from './database/connection'

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

// --- Work Logs CRUD ---

export interface WorkLog {
  id: number
  content: string
  category: string
  created_at: string
  task_id: number | null
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
  createdAt?: string
): WorkLog {
  const resolvedTaskId = resolveWorkLogTaskId(taskId)
  const metadata = getWriteMetadata(createdAt)
  const stmt = db.prepare(
    `INSERT INTO work_logs (
      content, category, task_id, created_at, updated_at,
      public_id, workspace_id, created_by, updated_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`
  )
  return stmt.get(
    content,
    category,
    resolvedTaskId,
    metadata.timestamp,
    metadata.timestamp,
    metadata.publicId,
    metadata.workspaceId,
    metadata.userId,
    metadata.userId
  ) as WorkLog
}

export function getWorkLogs(limit = 200, offset = 0): WorkLog[] {
  const stmt = db.prepare(
    'SELECT * FROM work_logs ORDER BY created_at DESC LIMIT ? OFFSET ?'
  )
  return stmt.all(limit, offset) as WorkLog[]
}

export function getWorkLogsByDateRange(from: string, to: string): WorkLog[] {
  const stmt = db.prepare(
    'SELECT * FROM work_logs WHERE date(created_at) >= date(?) AND date(created_at) <= date(?) ORDER BY created_at ASC'
  )
  return stmt.all(from, to) as WorkLog[]
}

export function searchWorkLogs(keyword: string, limit = 200): WorkLog[] {
  const stmt = db.prepare(
    'SELECT * FROM work_logs WHERE content LIKE ? ORDER BY created_at DESC LIMIT ?'
  )
  return stmt.all(`%${keyword}%`, limit) as WorkLog[]
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
  title: string
  description: string
  status: 'todo' | 'in_progress' | 'done' | 'draft'
  board_column: string
  position: number
  created_at: string
  updated_at: string
  completed_at: string | null
  due_date: string | null
}

export function addTask(title: string, description = '', status: 'todo' | 'draft' = 'todo', createdAt?: string): Task {
  const maxPos = db.prepare(
    'SELECT COALESCE(MAX(position), -1) + 1 as next FROM tasks WHERE status = ?'
  ).get(status) as { next: number }

  const metadata = getWriteMetadata(createdAt)
  const stmt = db.prepare(
    `INSERT INTO tasks (
      title, description, status, board_column, position, created_at, updated_at,
      public_id, workspace_id, created_by, updated_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`
  )
  return stmt.get(
    title,
    description,
    status,
    status,
    maxPos.next,
    metadata.timestamp,
    metadata.timestamp,
    metadata.publicId,
    metadata.workspaceId,
    metadata.userId,
    metadata.userId
  ) as Task
}

export function getTasks(): Task[] {
  const stmt = db.prepare('SELECT * FROM tasks ORDER BY position ASC')
  return stmt.all() as Task[]
}

export function updateTask(
  id: number,
  updates: Partial<Pick<Task, 'title' | 'description' | 'status' | 'position' | 'due_date'>>
): Task | null {
  const fields: string[] = []
  const values: unknown[] = []
  const metadata = getWriteMetadata()

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

  fields.push('updated_at = ?', 'updated_by = ?')
  values.push(metadata.timestamp, metadata.userId)
  values.push(id)

  const stmt = db.prepare(
    `UPDATE tasks SET ${fields.join(', ')} WHERE id = ? RETURNING *`
  )
  return stmt.get(...values) as Task | null
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
  return db.prepare('SELECT * FROM work_logs ORDER BY created_at DESC').all() as WorkLog[]
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

export function updateWorkLog(id: number, content: string, category: string, created_at?: string): WorkLog | null {
  const metadata = getWriteMetadata(created_at)
  if (created_at) {
    const stmt = db.prepare('UPDATE work_logs SET content = ?, category = ?, created_at = ?, updated_at = ?, updated_by = ? WHERE id = ? RETURNING *')
    return stmt.get(content, category, metadata.timestamp, metadata.timestamp, metadata.userId, id) as WorkLog | null
  }
  const stmt = db.prepare('UPDATE work_logs SET content = ?, category = ?, updated_at = ?, updated_by = ? WHERE id = ? RETURNING *')
  return stmt.get(content, category, metadata.timestamp, metadata.userId, id) as WorkLog | null
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

import type Database from 'better-sqlite3'

import type { InboxItem, InboxState, InboxSuggestion, Page } from '../domain/types'
import type { InboxPagination, InboxRepository, Pagination, ReadOptions, WorkspaceContext } from './contracts'

const DEFAULT_LIMIT = 50

interface InboxRow {
  id: number
  public_id: string
  content: string
  project_public_id: string | null
  state: InboxState
  include_in_reports: number
  ai_suggestion: string | null
  created_at: string
  updated_at: string
}

function parseSuggestion(value: string | null): InboxSuggestion | null {
  if (!value) return null
  try {
    return JSON.parse(value) as InboxSuggestion
  } catch {
    throw new Error('Inbox suggestion is invalid')
  }
}

function toInboxItem(row: InboxRow): InboxItem {
  return {
    public_id: row.public_id,
    content: row.content,
    project_id: row.project_public_id,
    state: row.state,
    include_in_reports: Boolean(row.include_in_reports),
    ai_suggestion: parseSuggestion(row.ai_suggestion),
    created_at: row.created_at,
    updated_at: row.updated_at
  }
}

function resolvePagination(pagination: Pagination = {}): Required<Pagination> {
  return {
    limit: Math.min(Math.max(pagination.limit ?? DEFAULT_LIMIT, 1), 200),
    offset: Math.max(pagination.offset ?? 0, 0)
  }
}

const inboxSelect = `
  SELECT
    inbox_items.id,
    inbox_items.public_id,
    inbox_items.content,
    projects.public_id AS project_public_id,
    inbox_items.state,
    inbox_items.include_in_reports,
    inbox_items.ai_suggestion,
    inbox_items.created_at,
    inbox_items.updated_at
  FROM inbox_items
  LEFT JOIN projects ON projects.id = inbox_items.project_id
    AND projects.workspace_id = inbox_items.workspace_id AND projects.deleted_at IS NULL
`

export class LocalInboxRepository implements InboxRepository {
  constructor(private readonly database: Database.Database) {}

  list(context: WorkspaceContext, pagination?: InboxPagination): Page<InboxItem> {
    const { limit, offset } = resolvePagination(pagination)
    const stateClause = pagination?.state ? ' AND inbox_items.state = ?' : ''
    const listArguments: unknown[] = [context.workspace_id]
    if (pagination?.state) listArguments.push(pagination.state)
    listArguments.push(limit, offset)
    const items = this.database.prepare(`${inboxSelect}
      WHERE inbox_items.workspace_id = ? AND inbox_items.deleted_at IS NULL${stateClause}
      ORDER BY inbox_items.created_at DESC, inbox_items.id DESC
      LIMIT ? OFFSET ?
    `).all(...listArguments) as InboxRow[]
    const totalArguments: unknown[] = [context.workspace_id]
    if (pagination?.state) totalArguments.push(pagination.state)
    const total = this.database.prepare(`
      SELECT COUNT(*) AS count FROM inbox_items
      WHERE workspace_id = ? AND deleted_at IS NULL${pagination?.state ? ' AND state = ?' : ''}
    `).get(...totalArguments) as { count: number }
    return { items: items.map(toInboxItem), total: total.count }
  }

  listUnorganized(context: WorkspaceContext, limit = 20, publicIds?: string[]): InboxItem[] {
    const safeLimit = Math.min(Math.max(limit, 1), 20)
    if (publicIds?.length) {
      return publicIds
        .map((publicId) => this.get(context, publicId))
        .filter((item): item is InboxItem => Boolean(item && item.state === 'unorganized'))
        .slice(0, safeLimit)
    }
    const items = this.database.prepare(`${inboxSelect}
      WHERE inbox_items.workspace_id = ? AND inbox_items.deleted_at IS NULL AND inbox_items.state = 'unorganized'
      ORDER BY inbox_items.created_at DESC, inbox_items.id DESC
      LIMIT ?
    `).all(context.workspace_id, safeLimit) as InboxRow[]
    return items.map(toInboxItem)
  }

  get(context: WorkspaceContext, publicId: string, options: ReadOptions = {}): InboxItem | null {
    const row = this.database.prepare(`${inboxSelect}
      WHERE inbox_items.workspace_id = ? AND inbox_items.public_id = ?
      ${options.includeDeleted ? '' : 'AND inbox_items.deleted_at IS NULL'}
    `).get(context.workspace_id, publicId) as InboxRow | undefined
    return row ? toInboxItem(row) : null
  }

  create(context: WorkspaceContext, input: InboxItem): InboxItem {
    const row = this.database.prepare(`
      INSERT INTO inbox_items (
        public_id, workspace_id, project_id, content, state,
        include_in_reports, ai_suggestion, created_by, updated_by, created_at, updated_at
      ) VALUES (
        ?, ?,
        (SELECT id FROM projects WHERE workspace_id = ? AND public_id = ? AND deleted_at IS NULL),
        ?, ?, ?, ?, ?, ?, ?, ?
      )
      RETURNING id, public_id, content,
        (SELECT public_id FROM projects WHERE id = project_id AND workspace_id = ? AND deleted_at IS NULL) AS project_public_id,
        state, include_in_reports, ai_suggestion, created_at, updated_at
    `).get(
      input.public_id,
      context.workspace_id,
      context.workspace_id,
      input.project_id,
      input.content,
      input.state,
      Number(input.include_in_reports),
      input.ai_suggestion ? JSON.stringify(input.ai_suggestion) : null,
      context.user_id,
      context.user_id,
      input.created_at,
      input.updated_at,
      context.workspace_id
    ) as InboxRow
    return toInboxItem(row)
  }

  update(context: WorkspaceContext, publicId: string, input: Partial<InboxItem>): InboxItem | null {
    const fields: string[] = []
    const values: unknown[] = []
    if (input.project_id !== undefined) {
      fields.push('project_id = (SELECT id FROM projects WHERE workspace_id = ? AND public_id = ? AND deleted_at IS NULL)')
      values.push(context.workspace_id, input.project_id)
    }
    if (input.state !== undefined) {
      fields.push('state = ?')
      values.push(input.state)
    }
    if (input.include_in_reports !== undefined) {
      fields.push('include_in_reports = ?')
      values.push(Number(input.include_in_reports))
    }
    if (input.ai_suggestion !== undefined) {
      fields.push('ai_suggestion = ?')
      values.push(input.ai_suggestion ? JSON.stringify(input.ai_suggestion) : null)
    }
    if (fields.length === 0) return this.get(context, publicId)
    const now = new Date().toISOString()
    fields.push('updated_by = ?', 'updated_at = ?')
    values.push(context.user_id, now, context.workspace_id, publicId)
    this.database.prepare(`
      UPDATE inbox_items SET ${fields.join(', ')}
      WHERE workspace_id = ? AND public_id = ? AND deleted_at IS NULL
    `).run(...values)
    return this.get(context, publicId)
  }

  softDelete(context: WorkspaceContext, publicId: string): InboxItem | null {
    const now = new Date().toISOString()
    this.database.prepare(`
      UPDATE inbox_items SET deleted_at = ?, updated_by = ?, updated_at = ?
      WHERE workspace_id = ? AND public_id = ? AND deleted_at IS NULL
    `).run(now, context.user_id, now, context.workspace_id, publicId)
    return this.get(context, publicId, { includeDeleted: true })
  }

  getInternalId(context: WorkspaceContext, publicId: string): number | null {
    const row = this.database.prepare(`
      SELECT id FROM inbox_items
      WHERE workspace_id = ? AND public_id = ? AND deleted_at IS NULL
    `).get(context.workspace_id, publicId) as { id: number } | undefined
    return row?.id ?? null
  }
}

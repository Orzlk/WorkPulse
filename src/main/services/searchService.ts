import type Database from 'better-sqlite3'

import type { InboxItem, Page } from '../domain/types'
import type { Pagination, WorkspaceContext } from '../repositories/contracts'
import { LocalInboxRepository } from '../repositories/localInboxRepository'
import { normalizeTagName } from '../repositories/localTagRepository'

export interface InboxSearchQuery extends Pagination {
  text?: string
  tag_names?: string[]
  project_id?: string | null
  repository_id?: string | null
  state?: InboxItem['state']
}

export class SearchService {
  constructor(
    private readonly database: Database.Database,
    private readonly context: WorkspaceContext,
    private readonly inbox = new LocalInboxRepository(database)
  ) {}

  searchInbox(query: InboxSearchQuery = {}): Page<InboxItem> {
    this.assertWorkspace()
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200)
    const offset = Math.max(query.offset ?? 0, 0)
    const conditions = ['inbox_items.workspace_id = ?', 'inbox_items.deleted_at IS NULL']
    const values: unknown[] = [this.context.workspace_id]
    if (query.project_id !== undefined) {
      conditions.push(`EXISTS (
        SELECT 1 FROM projects
        WHERE projects.id = inbox_items.project_id
          AND projects.workspace_id = inbox_items.workspace_id
          AND projects.public_id = ? AND projects.deleted_at IS NULL
      )`)
      values.push(query.project_id)
    }
    if (query.repository_id !== undefined) {
      conditions.push(`EXISTS (
        SELECT 1 FROM repositories
        WHERE repositories.id = inbox_items.repository_id
          AND repositories.workspace_id = inbox_items.workspace_id
          AND repositories.public_id = ? AND repositories.deleted_at IS NULL
      )`)
      values.push(query.repository_id)
    }
    if (query.state) {
      conditions.push('inbox_items.state = ?')
      values.push(query.state)
    }
    if (query.text?.trim()) {
      conditions.push(`EXISTS (
        SELECT 1 FROM content_search
        WHERE content_search.entity_type = 'inbox_item'
          AND content_search.entity_id = CAST(inbox_items.id AS TEXT)
          AND content_search.workspace_id = inbox_items.workspace_id
          AND content_search.content LIKE ?
      )`)
      values.push(`%${query.text.trim()}%`)
    }
    for (const tagName of query.tag_names ?? []) {
      const path = normalizeTagName(tagName)
      conditions.push(`EXISTS (
        SELECT 1
        FROM inbox_tags
        INNER JOIN tags ON tags.id = inbox_tags.tag_id
        WHERE inbox_tags.inbox_item_id = inbox_items.id
          AND tags.workspace_id = inbox_items.workspace_id
          AND tags.deleted_at IS NULL
          AND (tags.path = ? OR tags.path LIKE ?)
      )`)
      values.push(path, `${path}/%`)
    }
    const where = conditions.join(' AND ')
    const rows = this.database.prepare(`
      SELECT inbox_items.public_id
      FROM inbox_items
      WHERE ${where}
      ORDER BY inbox_items.created_at DESC, inbox_items.id DESC
      LIMIT ? OFFSET ?
    `).all(...values, limit, offset) as Array<{ public_id: string }>
    const total = this.database.prepare(`
      SELECT COUNT(*) AS count FROM inbox_items
      WHERE ${where}
    `).get(...values) as { count: number }
    return {
      items: rows.map((row) => this.inbox.get(this.context, row.public_id)).filter((item): item is InboxItem => item !== null),
      total: total.count
    }
  }

  private assertWorkspace(): void {
    const row = this.database.prepare(`
      SELECT 1
      FROM workspaces
      INNER JOIN users ON users.workspace_id = workspaces.id
      WHERE workspaces.id = ? AND users.id = ?
        AND workspaces.deleted_at IS NULL AND users.deleted_at IS NULL
    `).get(this.context.workspace_id, this.context.user_id)
    if (!row) throw new Error('Workspace not found')
  }
}

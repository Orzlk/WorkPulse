import type Database from 'better-sqlite3'

import type { InboxItem, Page, SearchResult } from '../domain/types'
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

  search(query: Pagination & { text?: string }): Page<SearchResult> {
    this.assertWorkspace()
    const text = query.text?.trim() ?? ''
    const like = `%${text}%`
    const rows: SearchResult[] = []
    const tagSelect = (table: string, column: string): string => `
      (SELECT GROUP_CONCAT(tags.path, ',') FROM ${table}
       INNER JOIN tags ON tags.id = ${table}.tag_id AND tags.workspace_id = ? AND tags.deleted_at IS NULL
       WHERE ${table}.${column} = entity.id) AS tag_paths`

    const logRows = this.database.prepare(`
      SELECT entity.public_id, entity.content AS title, entity.content AS excerpt, entity.created_at AS time,
        projects.public_id AS project_id, projects.name AS project_name,
        repositories.public_id AS repository_id, repositories.name AS repository_name,
        ${tagSelect('work_log_tags', 'work_log_id')}
      FROM work_logs AS entity
      LEFT JOIN projects ON projects.id = entity.project_id AND projects.workspace_id = entity.workspace_id AND projects.deleted_at IS NULL
      LEFT JOIN repositories ON repositories.id = entity.repository_id AND repositories.workspace_id = entity.workspace_id AND repositories.deleted_at IS NULL
      WHERE entity.workspace_id = ? AND entity.deleted_at IS NULL
        AND (? = '' OR entity.content LIKE ? OR entity.category LIKE ?)
      GROUP BY entity.id ORDER BY entity.created_at DESC, entity.id DESC
    `).all(this.context.workspace_id, this.context.workspace_id, text, like, like) as Array<Record<string, unknown>>
    rows.push(...logRows.map((row) => this.toSearchResult('work_log', row)))

    const taskRows = this.database.prepare(`
      SELECT entity.public_id, entity.title, COALESCE(NULLIF(entity.description, ''), entity.title) AS excerpt,
        entity.created_at AS time, projects.public_id AS project_id, projects.name AS project_name,
        repositories.public_id AS repository_id, repositories.name AS repository_name,
        ${tagSelect('task_tags', 'task_id')}
      FROM tasks AS entity
      LEFT JOIN projects ON projects.id = entity.project_id AND projects.workspace_id = entity.workspace_id AND projects.deleted_at IS NULL
      LEFT JOIN repositories ON repositories.id = entity.repository_id AND repositories.workspace_id = entity.workspace_id AND repositories.deleted_at IS NULL
      WHERE entity.workspace_id = ? AND entity.deleted_at IS NULL
        AND (? = '' OR entity.title LIKE ? OR entity.description LIKE ?)
      GROUP BY entity.id ORDER BY entity.created_at DESC, entity.id DESC
    `).all(this.context.workspace_id, this.context.workspace_id, text, like, like) as Array<Record<string, unknown>>
    rows.push(...taskRows.map((row) => this.toSearchResult('task', row)))

    const inboxRows = this.database.prepare(`
      SELECT entity.public_id, entity.content AS title, entity.content AS excerpt, entity.created_at AS time,
        projects.public_id AS project_id, projects.name AS project_name,
        repositories.public_id AS repository_id, repositories.name AS repository_name,
        ${tagSelect('inbox_tags', 'inbox_item_id')}
      FROM inbox_items AS entity
      LEFT JOIN projects ON projects.id = entity.project_id AND projects.workspace_id = entity.workspace_id AND projects.deleted_at IS NULL
      LEFT JOIN repositories ON repositories.id = entity.repository_id AND repositories.workspace_id = entity.workspace_id AND repositories.deleted_at IS NULL
      WHERE entity.workspace_id = ? AND entity.deleted_at IS NULL
        AND (? = '' OR entity.content LIKE ?)
      GROUP BY entity.id ORDER BY entity.created_at DESC, entity.id DESC
    `).all(this.context.workspace_id, this.context.workspace_id, text, like) as Array<Record<string, unknown>>
    rows.push(...inboxRows.map((row) => this.toSearchResult('inbox', row)))

    const commitRows = this.database.prepare(`
      SELECT entity.public_id, entity.message AS title, entity.message AS excerpt, entity.committed_at AS time,
        projects.public_id AS project_id, projects.name AS project_name,
        repositories.public_id AS repository_id, repositories.name AS repository_name,
        NULL AS tag_paths
      FROM git_commits AS entity
      INNER JOIN repositories ON repositories.id = entity.repository_id
        AND repositories.workspace_id = entity.workspace_id AND repositories.deleted_at IS NULL
      LEFT JOIN projects ON projects.id = repositories.project_id
        AND projects.workspace_id = repositories.workspace_id AND projects.deleted_at IS NULL
      WHERE entity.workspace_id = ? AND entity.deleted_at IS NULL
        AND (? = '' OR entity.message LIKE ? OR entity.commit_hash LIKE ?)
      ORDER BY entity.committed_at DESC, entity.id DESC
    `).all(this.context.workspace_id, text, like, like) as Array<Record<string, unknown>>
    rows.push(...commitRows.map((row) => this.toSearchResult('git_commit', row)))

    const reportRows = this.database.prepare(`
      SELECT entity.public_id, entity.type || ' report' AS title, entity.content AS excerpt,
        COALESCE(entity.generated_at, entity.updated_at) AS time,
        projects.public_id AS project_id, projects.name AS project_name,
        NULL AS repository_id, NULL AS repository_name, NULL AS tag_paths
      FROM reports AS entity
      LEFT JOIN report_projects ON report_projects.report_id = entity.id
      LEFT JOIN projects ON projects.id = report_projects.project_id
        AND projects.workspace_id = entity.workspace_id AND projects.deleted_at IS NULL
      WHERE entity.workspace_id = ? AND entity.deleted_at IS NULL
        AND (? = '' OR entity.content LIKE ? OR entity.type LIKE ?)
      GROUP BY entity.id ORDER BY COALESCE(entity.generated_at, entity.updated_at) DESC, entity.id DESC
    `).all(this.context.workspace_id, text, like, like) as Array<Record<string, unknown>>
    rows.push(...reportRows.map((row) => this.toSearchResult('report', row)))

    rows.sort((left, right) => right.time.localeCompare(left.time))
    const offset = Math.max(query.offset ?? 0, 0)
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200)
    return { items: rows.slice(offset, offset + limit), total: rows.length }
  }

  private toSearchResult(source: SearchResult['source'], row: Record<string, unknown>): SearchResult {
    return {
      source,
      public_id: String(row.public_id),
      title: String(row.title ?? ''),
      excerpt: String(row.excerpt ?? ''),
      project_id: row.project_id as string | null,
      project_name: row.project_name as string | null,
      repository_id: row.repository_id as string | null,
      repository_name: row.repository_name as string | null,
      tags: row.tag_paths ? String(row.tag_paths).split(',').filter(Boolean) : [],
      time: String(row.time)
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

import { randomUUID } from 'node:crypto'

import type Database from 'better-sqlite3'

import type { Page, Tag } from '../domain/types'
import type { Pagination, ReadOptions, TagRepository, WorkspaceContext } from './contracts'

const DEFAULT_LIMIT = 50

const TAG_USAGE_COUNT_SQL = `
  (SELECT COUNT(*) FROM work_log_tags
    INNER JOIN work_logs ON work_logs.id = work_log_tags.work_log_id
    WHERE work_log_tags.tag_id = tags.id AND work_logs.workspace_id = tags.workspace_id AND work_logs.deleted_at IS NULL)
  + (SELECT COUNT(*) FROM task_tags
    INNER JOIN tasks ON tasks.id = task_tags.task_id
    WHERE task_tags.tag_id = tags.id AND tasks.workspace_id = tags.workspace_id AND tasks.deleted_at IS NULL)
  + (SELECT COUNT(*) FROM inbox_tags
    INNER JOIN inbox_items ON inbox_items.id = inbox_tags.inbox_item_id
    WHERE inbox_tags.tag_id = tags.id AND inbox_items.workspace_id = tags.workspace_id AND inbox_items.deleted_at IS NULL)
  + (SELECT COUNT(*) FROM git_commit_tags
    INNER JOIN git_commits ON git_commits.id = git_commit_tags.git_commit_id
    WHERE git_commit_tags.tag_id = tags.id AND git_commits.workspace_id = tags.workspace_id AND git_commits.deleted_at IS NULL)
  + (SELECT COUNT(*) FROM report_tags
    INNER JOIN reports ON reports.id = report_tags.report_id
    WHERE report_tags.tag_id = tags.id AND reports.workspace_id = tags.workspace_id AND reports.deleted_at IS NULL)
`

export function normalizeTagName(value: string): string {
  const withoutHash = value.trim().replace(/^#/, '')
  const path = withoutHash
    .split('/')
    .map((segment) => segment.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .join('/')
    .toLowerCase()
  if (!path) throw new Error('Tag name is required')
  return path
}

function toTag(row: Record<string, unknown>): Tag {
  return {
    public_id: row.public_id as string,
    name: row.name as string,
    path: row.path as string,
    parent_id: row.parent_public_id as string | null,
    usage_count: Number(row.usage_count ?? 0)
  }
}

function resolvePagination(pagination: Pagination = {}): Required<Pagination> {
  return {
    limit: Math.min(Math.max(pagination.limit ?? DEFAULT_LIMIT, 1), 200),
    offset: Math.max(pagination.offset ?? 0, 0)
  }
}

export class LocalTagRepository implements TagRepository {
  constructor(private readonly database: Database.Database) {}

  list(context: WorkspaceContext, pagination?: Pagination): Page<Tag> {
    const { limit, offset } = resolvePagination(pagination)
    const items = this.database.prepare(`
      SELECT tags.public_id, tags.name, tags.path, parent.public_id AS parent_public_id,
        ${TAG_USAGE_COUNT_SQL} AS usage_count
      FROM tags
      LEFT JOIN tags AS parent ON parent.id = tags.parent_id AND parent.deleted_at IS NULL
      WHERE tags.workspace_id = ? AND tags.deleted_at IS NULL
      ORDER BY tags.path ASC
      LIMIT ? OFFSET ?
    `).all(context.workspace_id, limit, offset) as Record<string, unknown>[]
    const total = this.database.prepare(`
      SELECT COUNT(*) AS count FROM tags
      WHERE workspace_id = ? AND deleted_at IS NULL
    `).get(context.workspace_id) as { count: number }
    return { items: items.map(toTag), total: total.count }
  }

  get(context: WorkspaceContext, publicId: string, options: ReadOptions = {}): Tag | null {
    const row = this.database.prepare(`
      SELECT tags.public_id, tags.name, tags.path, parent.public_id AS parent_public_id,
        ${TAG_USAGE_COUNT_SQL} AS usage_count
      FROM tags
      LEFT JOIN tags AS parent ON parent.id = tags.parent_id AND parent.deleted_at IS NULL
      WHERE tags.workspace_id = ? AND tags.public_id = ? ${options.includeDeleted ? '' : 'AND tags.deleted_at IS NULL'}
    `).get(context.workspace_id, publicId) as Record<string, unknown> | undefined
    return row ? toTag(row) : null
  }

  create(context: WorkspaceContext, name: string): Tag {
    const path = normalizeTagName(name)
    const now = new Date().toISOString()
    const existing = this.database.prepare(`
      SELECT id, public_id, name, path, parent_id, deleted_at FROM tags
      WHERE workspace_id = ? AND path = ?
    `).get(context.workspace_id, path) as Record<string, unknown> | undefined
    if (existing) {
      if (existing.deleted_at !== null) {
        this.database.prepare(`
          UPDATE tags SET deleted_at = NULL, updated_at = ?
          WHERE workspace_id = ? AND id = ?
        `).run(now, context.workspace_id, existing.id)
      }
      return this.get(context, existing.public_id as string) as Tag
    }

    const row = this.database.prepare(`
      INSERT INTO tags (public_id, workspace_id, name, path, parent_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      RETURNING public_id, name, path, NULL AS parent_public_id
    `).get(randomUUID(), context.workspace_id, path, path, null, now, now) as Record<string, unknown>
    return toTag(row)
  }

  update(context: WorkspaceContext, publicId: string, name: string): Tag | null {
    const path = normalizeTagName(name)
    const now = new Date().toISOString()
    const row = this.database.prepare(`
      UPDATE tags SET name = ?, path = ?, updated_at = ?
      WHERE workspace_id = ? AND public_id = ? AND deleted_at IS NULL
      RETURNING public_id, name, path, NULL AS parent_public_id
    `).get(path, path, now, context.workspace_id, publicId) as Record<string, unknown> | undefined
    return row ? toTag(row) : null
  }

  softDelete(context: WorkspaceContext, publicId: string): Tag | null {
    const now = new Date().toISOString()
    const row = this.database.prepare(`
      UPDATE tags SET deleted_at = ?, updated_at = ?
      WHERE workspace_id = ? AND public_id = ? AND deleted_at IS NULL
      RETURNING public_id, name, path, NULL AS parent_public_id
    `).get(now, now, context.workspace_id, publicId) as Record<string, unknown> | undefined
    return row ? toTag(row) : null
  }

  assignToInbox(context: WorkspaceContext, inboxId: number, tag: Tag): void {
    this.database.prepare(`
      INSERT OR IGNORE INTO inbox_tags (inbox_item_id, tag_id)
      SELECT ?, tags.id FROM tags
      WHERE tags.workspace_id = ? AND tags.public_id = ? AND tags.deleted_at IS NULL
    `).run(inboxId, context.workspace_id, tag.public_id)
  }

  assignToWorkLog(context: WorkspaceContext, workLogId: number, tag: Tag): void {
    this.database.prepare(`
      INSERT OR IGNORE INTO work_log_tags (work_log_id, tag_id)
      SELECT ?, tags.id FROM tags
      WHERE tags.workspace_id = ? AND tags.public_id = ? AND tags.deleted_at IS NULL
    `).run(workLogId, context.workspace_id, tag.public_id)
  }

  assignToTask(context: WorkspaceContext, taskId: number, tag: Tag): void {
    this.database.prepare(`
      INSERT OR IGNORE INTO task_tags (task_id, tag_id)
      SELECT ?, tags.id FROM tags
      WHERE tags.workspace_id = ? AND tags.public_id = ? AND tags.deleted_at IS NULL
    `).run(taskId, context.workspace_id, tag.public_id)
  }
}

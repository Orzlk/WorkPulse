import { randomUUID } from 'node:crypto'

import type Database from 'better-sqlite3'

import type { Page, Project } from '../domain/types'
import type { Pagination, ProjectRepository, ReadOptions, WorkspaceContext } from './contracts'

const DEFAULT_LIMIT = 50

function toProject(row: Record<string, unknown>): Project {
  return {
    public_id: row.public_id as string,
    name: row.name as string,
    description: row.description as string,
    color: row.color as string,
    archived_at: row.deleted_at as string | null
  }
}

function resolvePagination(pagination: Pagination = {}): Required<Pagination> {
  return {
    limit: Math.min(Math.max(pagination.limit ?? DEFAULT_LIMIT, 1), 200),
    offset: Math.max(pagination.offset ?? 0, 0)
  }
}

export class LocalProjectRepository implements ProjectRepository {
  constructor(private readonly database: Database.Database) {}

  list(context: WorkspaceContext, pagination?: Pagination): Page<Project> {
    const { limit, offset } = resolvePagination(pagination)
    const items = this.database.prepare(`
      SELECT public_id, name, description, color, deleted_at
      FROM projects
      WHERE workspace_id = ? AND deleted_at IS NULL
      ORDER BY updated_at DESC, id DESC
      LIMIT ? OFFSET ?
    `).all(context.workspace_id, limit, offset) as Record<string, unknown>[]
    const total = this.database.prepare(`
      SELECT COUNT(*) AS count FROM projects
      WHERE workspace_id = ? AND deleted_at IS NULL
    `).get(context.workspace_id) as { count: number }
    return { items: items.map(toProject), total: total.count }
  }

  get(context: WorkspaceContext, publicId: string, options: ReadOptions = {}): Project | null {
    const row = this.database.prepare(`
      SELECT public_id, name, description, color, deleted_at
      FROM projects
      WHERE workspace_id = ? AND public_id = ? ${options.includeDeleted ? '' : 'AND deleted_at IS NULL'}
    `).get(context.workspace_id, publicId) as Record<string, unknown> | undefined
    return row ? toProject(row) : null
  }

  create(context: WorkspaceContext, input: Omit<Project, 'public_id' | 'archived_at'>): Project {
    const now = new Date().toISOString()
    const publicId = randomUUID()
    const row = this.database.prepare(`
      INSERT INTO projects (
        public_id, workspace_id, name, description, color,
        created_by, updated_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING public_id, name, description, color, deleted_at
    `).get(
      publicId,
      context.workspace_id,
      input.name,
      input.description,
      input.color,
      context.user_id,
      context.user_id,
      now,
      now
    ) as Record<string, unknown>
    return toProject(row)
  }

  update(
    context: WorkspaceContext,
    publicId: string,
    input: Partial<Omit<Project, 'public_id' | 'archived_at'>>
  ): Project | null {
    const fields: string[] = []
    const values: unknown[] = []
    for (const key of ['name', 'description', 'color'] as const) {
      if (input[key] !== undefined) {
        fields.push(`${key} = ?`)
        values.push(input[key])
      }
    }
    if (fields.length === 0) return this.get(context, publicId)
    const now = new Date().toISOString()
    const row = this.database.prepare(`
      UPDATE projects SET ${fields.join(', ')}, updated_by = ?, updated_at = ?
      WHERE workspace_id = ? AND public_id = ? AND deleted_at IS NULL
      RETURNING public_id, name, description, color, deleted_at
    `).get(...values, context.user_id, now, context.workspace_id, publicId) as Record<string, unknown> | undefined
    return row ? toProject(row) : null
  }

  softDelete(context: WorkspaceContext, publicId: string): Project | null {
    const now = new Date().toISOString()
    const row = this.database.prepare(`
      UPDATE projects SET deleted_at = ?, updated_by = ?, updated_at = ?
      WHERE workspace_id = ? AND public_id = ? AND deleted_at IS NULL
      RETURNING public_id, name, description, color, deleted_at
    `).get(now, context.user_id, now, context.workspace_id, publicId) as Record<string, unknown> | undefined
    return row ? toProject(row) : null
  }
}

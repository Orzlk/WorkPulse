import { randomUUID } from 'node:crypto'

import type Database from 'better-sqlite3'

import type { Page, Project, ProjectInput } from '../domain/types'
import type { Pagination, ProjectRepository, ReadOptions, WorkspaceContext } from './contracts'

const DEFAULT_LIMIT = 50

function toProject(row: Record<string, unknown>): Project {
  return {
    public_id: row.public_id as string,
    name: row.name as string,
    description: row.description as string,
    color: row.color as string,
    archived_at: row.deleted_at as string | null,
    summary: {
      work_logs: Number(row.work_log_count ?? 0),
      tasks: Number(row.task_count ?? 0),
      git_commits: Number(row.git_commit_count ?? 0),
      reports: Number(row.report_count ?? 0)
    }
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
      SELECT public_id, name, description, color, deleted_at,
        (SELECT COUNT(*) FROM work_logs WHERE work_logs.project_id = projects.id AND work_logs.workspace_id = projects.workspace_id AND work_logs.deleted_at IS NULL) AS work_log_count,
        (SELECT COUNT(*) FROM tasks WHERE tasks.project_id = projects.id AND tasks.workspace_id = projects.workspace_id AND tasks.deleted_at IS NULL) AS task_count,
        (SELECT COUNT(*) FROM git_commits
          INNER JOIN repositories ON repositories.id = git_commits.repository_id
          WHERE repositories.project_id = projects.id AND repositories.workspace_id = projects.workspace_id
            AND repositories.deleted_at IS NULL AND git_commits.deleted_at IS NULL) AS git_commit_count,
        (SELECT COUNT(DISTINCT reports.id) FROM reports
          WHERE reports.workspace_id = projects.workspace_id AND reports.deleted_at IS NULL
            AND (
              EXISTS (
                SELECT 1 FROM json_each(
                  CASE WHEN json_valid(reports.project_scope) THEN reports.project_scope ELSE '[]' END
                ) WHERE json_each.value = projects.public_id
              )
              OR EXISTS (
                SELECT 1 FROM report_projects
                WHERE report_projects.report_id = reports.id AND report_projects.project_id = projects.id
              )
              OR EXISTS (
                SELECT 1 FROM json_each(
                  CASE
                    WHEN json_valid(reports.source_snapshot)
                    THEN COALESCE(json_extract(reports.source_snapshot, '$.projects'), '[]')
                    ELSE '[]'
                  END
                ) WHERE json_extract(json_each.value, '$.public_id') = projects.public_id
              )
            )) AS report_count
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
      SELECT public_id, name, description, color, deleted_at,
        0 AS work_log_count, 0 AS task_count, 0 AS git_commit_count, 0 AS report_count
      FROM projects
      WHERE workspace_id = ? AND public_id = ? ${options.includeDeleted ? '' : 'AND deleted_at IS NULL'}
    `).get(context.workspace_id, publicId) as Record<string, unknown> | undefined
    return row ? toProject(row) : null
  }

  create(context: WorkspaceContext, input: ProjectInput): Project {
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
    return { ...toProject(row), summary: { work_logs: 0, tasks: 0, git_commits: 0, reports: 0 } }
  }

  update(
    context: WorkspaceContext,
    publicId: string,
    input: Partial<ProjectInput>
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
    return row ? { ...toProject(row), summary: { work_logs: 0, tasks: 0, git_commits: 0, reports: 0 } } : null
  }

  softDelete(context: WorkspaceContext, publicId: string): Project | null {
    const now = new Date().toISOString()
    const row = this.database.prepare(`
      UPDATE projects SET deleted_at = ?, updated_by = ?, updated_at = ?
      WHERE workspace_id = ? AND public_id = ? AND deleted_at IS NULL
      RETURNING public_id, name, description, color, deleted_at
    `).get(now, context.user_id, now, context.workspace_id, publicId) as Record<string, unknown> | undefined
    return row ? { ...toProject(row), summary: { work_logs: 0, tasks: 0, git_commits: 0, reports: 0 } } : null
  }
}

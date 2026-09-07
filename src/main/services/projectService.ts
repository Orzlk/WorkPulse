
import type Database from 'better-sqlite3'

import type { Page, Project, ProjectActivityItem, ProjectInput } from '../domain/types'
import type { Pagination, ReadOptions, WorkspaceContext } from '../repositories/contracts'
import { enqueueOutbox } from '../sync/outbox'
import { LocalProjectRepository } from '../repositories/localProjectRepository'

export class ProjectService {
  private readonly projects: LocalProjectRepository

  constructor(
    private readonly database: Database.Database,
    private readonly context: WorkspaceContext
  ) {
    this.projects = new LocalProjectRepository(database)
  }

  list(pagination?: Pagination): Page<Project> {
    this.assertWorkspace()
    return this.projects.list(this.context, pagination)
  }

  get(publicId: string, options?: ReadOptions): Project | null {
    this.assertWorkspace()
    return this.projects.get(this.context, publicId, options)
  }

  activity(publicId: string): ProjectActivityItem[] {
    this.assertWorkspace()
    const project = this.database.prepare(`
      SELECT id, public_id
      FROM projects
      WHERE workspace_id = ? AND public_id = ? AND deleted_at IS NULL
    `).get(this.context.workspace_id, publicId) as { id: number; public_id: string } | undefined
    if (!project) return []

    const rows = this.database.prepare(`
      SELECT * FROM (
        SELECT
          'work_log' AS type, work_logs.public_id, work_logs.content AS title, work_logs.content,
          work_logs.created_at AS occurred_at, NULL AS status, work_logs.category,
          NULL AS repository_name, NULL AS author_name, NULL AS author_email, NULL AS commit_hash,
          NULL AS branch, NULL AS files_changed, NULL AS additions, NULL AS deletions,
          NULL AS due_date, work_logs.id AS record_id
        FROM work_logs
        WHERE work_logs.workspace_id = ? AND work_logs.project_id = ? AND work_logs.deleted_at IS NULL

        UNION ALL

        SELECT
          'task' AS type, tasks.public_id, tasks.title, tasks.description AS content,
          tasks.updated_at AS occurred_at, tasks.status, NULL AS category,
          NULL AS repository_name, NULL AS author_name, NULL AS author_email, NULL AS commit_hash,
          NULL AS branch, NULL AS files_changed, NULL AS additions, NULL AS deletions,
          tasks.due_date, tasks.id AS record_id
        FROM tasks
        WHERE tasks.workspace_id = ? AND tasks.project_id = ? AND tasks.deleted_at IS NULL

        UNION ALL

        SELECT
          'inbox' AS type, inbox_items.public_id, inbox_items.content AS title, inbox_items.content,
          inbox_items.updated_at AS occurred_at, inbox_items.state AS status, NULL AS category,
          NULL AS repository_name, NULL AS author_name, NULL AS author_email, NULL AS commit_hash,
          NULL AS branch, NULL AS files_changed, NULL AS additions, NULL AS deletions,
          NULL AS due_date, inbox_items.id AS record_id
        FROM inbox_items
        WHERE inbox_items.workspace_id = ? AND inbox_items.project_id = ? AND inbox_items.deleted_at IS NULL

        UNION ALL

        SELECT
          'git_commit' AS type, git_commits.public_id, git_commits.message AS title, git_commits.message AS content,
          git_commits.committed_at AS occurred_at, NULL AS status, NULL AS category,
          repositories.name AS repository_name, git_commits.author_name, git_commits.author_email,
          git_commits.commit_hash, git_commits.branch, git_commits.files_changed,
          git_commits.additions, git_commits.deletions, NULL AS due_date, git_commits.id AS record_id
        FROM git_commits
        INNER JOIN repositories ON repositories.id = git_commits.repository_id
          AND repositories.workspace_id = git_commits.workspace_id
          AND repositories.deleted_at IS NULL
        WHERE git_commits.workspace_id = ? AND repositories.project_id = ? AND git_commits.deleted_at IS NULL

        UNION ALL

        SELECT
          'report' AS type, reports.public_id, reports.type AS title, reports.content,
          COALESCE(reports.generated_at, reports.updated_at, reports.created_at, reports.period_start) AS occurred_at,
          reports.status, NULL AS category, NULL AS repository_name, NULL AS author_name,
          NULL AS author_email, NULL AS commit_hash, NULL AS branch, NULL AS files_changed,
          NULL AS additions, NULL AS deletions, NULL AS due_date, reports.id AS record_id
        FROM reports
        WHERE reports.workspace_id = ? AND reports.deleted_at IS NULL
          AND (
            EXISTS (
              SELECT 1 FROM json_each(
                CASE WHEN json_valid(reports.project_scope) THEN reports.project_scope ELSE '[]' END
              ) WHERE json_each.value = ?
            )
            OR EXISTS (
              SELECT 1 FROM report_projects
              WHERE report_projects.report_id = reports.id AND report_projects.project_id = ?
            )
            OR EXISTS (
              SELECT 1 FROM json_each(
                CASE
                  WHEN json_valid(reports.source_snapshot)
                  THEN COALESCE(json_extract(reports.source_snapshot, '$.projects'), '[]')
                  ELSE '[]'
                END
              ) WHERE json_extract(json_each.value, '$.public_id') = ?
            )
          )
      ) AS activity
      ORDER BY occurred_at DESC, record_id DESC
      LIMIT 500
    `).all(
      this.context.workspace_id, project.id,
      this.context.workspace_id, project.id,
      this.context.workspace_id, project.id,
      this.context.workspace_id, project.id,
      this.context.workspace_id, project.public_id, project.id, project.public_id
    ) as ProjectActivityItem[]

    return rows.map((row) => ({
      public_id: row.public_id,
      type: row.type,
      title: row.title,
      content: row.content ?? '',
      occurred_at: row.occurred_at,
      status: row.status ?? null,
      category: row.category ?? null,
      repository_name: row.repository_name ?? null,
      author_name: row.author_name ?? null,
      author_email: row.author_email ?? null,
      commit_hash: row.commit_hash ?? null,
      branch: row.branch ?? null,
      files_changed: row.files_changed ?? null,
      additions: row.additions ?? null,
      deletions: row.deletions ?? null,
      due_date: row.due_date ?? null
    }))
  }

  create(input: ProjectInput): Project {
    this.assertWorkspace()
    if (!input.name.trim()) throw new Error('Project name is required')
    const create = this.database.transaction(() => {
      const project = this.projects.create(this.context, {
        name: input.name.trim(),
        description: input.description,
        color: input.color
      })
      this.enqueueSync('project', project.public_id, 'create', project)
      return project
    })
    return create()
  }

  update(publicId: string, input: Partial<ProjectInput>): Project | null {
    this.assertWorkspace()
    const update = this.database.transaction(() => {
      const project = this.projects.update(this.context, publicId, input)
      if (project) this.enqueueSync('project', project.public_id, 'update', project)
      return project
    })
    return update()
  }

  softDelete(publicId: string): Project | null {
    this.assertWorkspace()
    const remove = this.database.transaction(() => {
      const project = this.projects.softDelete(this.context, publicId)
      if (project) this.enqueueSync('project', project.public_id, 'delete', project)
      return project
    })
    return remove()
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

  private enqueueSync(
    entityType: string,
    entityPublicId: string,
    operationType: 'create' | 'update' | 'delete',
    payload: unknown
  ): void {
    const now = new Date().toISOString()
    enqueueOutbox(this.database, this.context.workspace_id, {
      entity: entityType,
      publicId: entityPublicId,
      operationType,
      changedAt: now,
      data: payload
    })
  }
}

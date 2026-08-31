import type Database from 'better-sqlite3'

import { resolveReportPeriod } from '../lib/period'
import type { WorkspaceContext } from '../repositories/contracts'
import type {
  ReportGitCommitSnapshot,
  ReportInboxSnapshot,
  ReportLogSnapshot,
  ReportPreview,
  ReportProjectSnapshot,
  ReportRequest,
  ReportSourceSnapshot,
  ReportTaskSnapshot
} from './reportTypes'

const UNASSIGNED_PROJECT_NAME = '未归属项目'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

interface ProjectRow {
  id: number
  public_id: string
  name: string
}

interface RepositoryRow {
  id: number
  public_id: string
  project_id: number | null
}

interface GroupState {
  group: ReportProjectSnapshot
  projectId: number | null
}

function parseTags(value: string | null): string[] {
  return value ? value.split(',').filter(Boolean) : []
}

function assertIds(ids: string[] | undefined, label: string): string[] {
  const normalized = Array.from(new Set(ids ?? []))
  if (normalized.some((id) => !UUID_PATTERN.test(id))) {
    throw new RangeError(`Invalid ${label} filter`)
  }
  return normalized
}

export class ReportQueryService {
  constructor(
    private readonly database: Database.Database,
    private readonly context: WorkspaceContext
  ) {}

  buildSnapshot(request: ReportRequest): ReportSourceSnapshot {
    this.assertWorkspace()
    if (request.type !== 'weekly' && request.type !== 'monthly') {
      throw new RangeError(`Invalid report type: ${String(request.type)}`)
    }
    const projectIds = assertIds(request.projectIds, 'project')
    const repositoryIds = assertIds(request.repositoryIds, 'repository')
    const period = resolveReportPeriod(request.type, request.anchorDate, request.timeZone)
    const projects = this.loadProjects(projectIds)
    const repositories = this.loadRepositories(repositoryIds)
    const allowedProjectIds = new Set(projects.map((project) => project.id))
    const allowedRepositoryIds = new Set(repositories.map((repository) => repository.id))
    const projectById = new Map(projects.map((project) => [project.id, project]))
    const repositoryById = new Map(repositories.map((repository) => [repository.id, repository]))
    const groups = new Map<number | null, GroupState>()

    const groupFor = (projectId: number | null): ReportProjectSnapshot => {
      const resolvedProjectId = projectId && projectById.has(projectId) ? projectId : null
      const existing = groups.get(resolvedProjectId)
      if (existing) return existing.group
      const project = resolvedProjectId ? projectById.get(resolvedProjectId)! : null
      const group: ReportProjectSnapshot = {
        public_id: project?.public_id ?? null,
        name: project?.name ?? UNASSIGNED_PROJECT_NAME,
        work_logs: [],
        tasks: [],
        inbox_items: [],
        git_commits: []
      }
      groups.set(resolvedProjectId, { group, projectId: resolvedProjectId })
      return group
    }

    const accepts = (projectId: number | null, repositoryId: number | null): boolean => {
      if (projectIds.length > 0 && (projectId === null || !allowedProjectIds.has(projectId))) return false
      if (repositoryIds.length > 0 && (repositoryId === null || !allowedRepositoryIds.has(repositoryId))) return false
      return true
    }

    const tagSql = (linkTable: string, entityColumn: string) => `
      (SELECT GROUP_CONCAT(tags.path, ',') FROM ${linkTable}
       INNER JOIN tags ON tags.id = ${linkTable}.tag_id AND tags.deleted_at IS NULL
       WHERE ${linkTable}.${entityColumn} = entity.id) AS tags
    `
    const range = [this.context.workspace_id, period.fromUtc, period.toUtc]

    const logRows = this.database.prepare(`
      SELECT entity.public_id, entity.project_id, entity.content, entity.created_at,
        ${tagSql('work_log_tags', 'work_log_id')}
      FROM work_logs AS entity
      WHERE entity.workspace_id = ? AND entity.deleted_at IS NULL
        AND entity.created_at >= ? AND entity.created_at < ?
      ORDER BY entity.created_at, entity.id
    `).all(...range) as Array<ReportLogSnapshot & { project_id: number | null; tags: string | null }>
    for (const row of logRows) {
      if (!accepts(row.project_id, null)) continue
      groupFor(row.project_id).work_logs.push({
        public_id: row.public_id, content: row.content, created_at: row.created_at, tags: parseTags(row.tags)
      })
    }

    const taskRows = this.database.prepare(`
      SELECT entity.public_id, entity.project_id, entity.title, entity.description,
        entity.status, entity.created_at, entity.completed_at, ${tagSql('task_tags', 'task_id')}
      FROM tasks AS entity
      WHERE entity.workspace_id = ? AND entity.deleted_at IS NULL
        AND ((entity.created_at >= ? AND entity.created_at < ?)
          OR (entity.completed_at >= ? AND entity.completed_at < ?))
      ORDER BY COALESCE(entity.completed_at, entity.created_at), entity.id
    `).all(this.context.workspace_id, period.fromUtc, period.toUtc, period.fromUtc, period.toUtc) as Array<ReportTaskSnapshot & {
      project_id: number | null
      tags: string | null
    }>
    for (const row of taskRows) {
      if (!accepts(row.project_id, null)) continue
      groupFor(row.project_id).tasks.push({
        public_id: row.public_id,
        title: row.title,
        description: row.description,
        status: row.status,
        created_at: row.created_at,
        completed_at: row.completed_at,
        tags: parseTags(row.tags)
      })
    }

    const inboxRows = this.database.prepare(`
      SELECT entity.public_id, entity.project_id, entity.content, entity.created_at,
        ${tagSql('inbox_tags', 'inbox_item_id')}
      FROM inbox_items AS entity
      WHERE entity.workspace_id = ? AND entity.deleted_at IS NULL
        AND entity.state = 'confirmed' AND entity.include_in_reports = 1
        AND entity.created_at >= ? AND entity.created_at < ?
      ORDER BY entity.created_at, entity.id
    `).all(...range) as Array<ReportInboxSnapshot & { project_id: number | null; tags: string | null }>
    for (const row of inboxRows) {
      if (!accepts(row.project_id, null)) continue
      groupFor(row.project_id).inbox_items.push({
        public_id: row.public_id, content: row.content, created_at: row.created_at, tags: parseTags(row.tags)
      })
    }

    const commitRows = this.database.prepare(`
      SELECT public_id, repository_id, commit_hash, committed_at, message, branch, files_changed, additions, deletions
      FROM git_commits
      WHERE workspace_id = ? AND deleted_at IS NULL
        AND committed_at >= ? AND committed_at < ?
      ORDER BY committed_at, id
    `).all(...range) as Array<ReportGitCommitSnapshot & { repository_id: number; message: string }>
    for (const row of commitRows) {
      const repository = repositoryById.get(row.repository_id)
      if (!repository || (projectIds.length > 0 && (repository.project_id === null || !allowedProjectIds.has(repository.project_id)))) continue
      groupFor(repository.project_id).git_commits.push({
        public_id: row.public_id,
        repository_id: repository.public_id,
        commit_hash: row.commit_hash,
        committed_at: row.committed_at,
        subject: row.message,
        branch: row.branch,
        files_changed: row.files_changed,
        additions: row.additions,
        deletions: row.deletions
      })
    }

    return {
      schema_version: 1,
      period,
      projects: Array.from(groups.values()).map(({ group }) => group).sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
    }
  }

  preview(request: ReportRequest): ReportPreview {
    const snapshot = this.buildSnapshot(request)
    const projectIds = assertIds(request.projectIds, 'project')
    const repositoryIds = assertIds(request.repositoryIds, 'repository')
    const projects = this.loadProjects(projectIds)
    const repositories = this.loadRepositories(repositoryIds)
    const allowedProjectIds = projects.map((project) => project.id)
    const allowedRepositoryIds = repositories.map((repository) => repository.id)
    const conditions = [
      'entity.workspace_id = ?',
      "entity.state = 'unorganized'",
      'entity.deleted_at IS NULL',
      'entity.created_at >= ?',
      'entity.created_at < ?'
    ]
    const values: Array<number | string> = [this.context.workspace_id, snapshot.period.fromUtc, snapshot.period.toUtc]
    if (projectIds.length > 0) {
      conditions.push(`entity.project_id IN (${allowedProjectIds.map(() => '?').join(', ')})`)
      values.push(...allowedProjectIds)
    }
    if (repositoryIds.length > 0) {
      conditions.push('1 = 0')
    }
    const unorganized = this.database.prepare(`
      SELECT COUNT(*) AS count FROM inbox_items AS entity
      WHERE ${conditions.join(' AND ')}
    `).get(...values) as { count: number }
    const groups = snapshot.projects

    return {
      type: request.type,
      display_start: snapshot.period.startDate,
      display_end_inclusive: previousCalendarDate(snapshot.period.endDateExclusive),
      project_count: projects.length,
      repository_count: repositories.length,
      work_log_count: groups.reduce((count, project) => count + project.work_logs.length, 0),
      task_count: groups.reduce((count, project) => count + project.tasks.length, 0),
      inbox_count: groups.reduce((count, project) => count + project.inbox_items.length, 0),
      git_commit_count: groups.reduce((count, project) => count + project.git_commits.length, 0),
      unorganized_inbox_count: unorganized.count
    }
  }

  private loadProjects(publicIds: string[]): ProjectRow[] {
    const params: Array<number | string> = [this.context.workspace_id]
    const filter = publicIds.length > 0 ? `AND public_id IN (${publicIds.map(() => '?').join(', ')})` : ''
    params.push(...publicIds)
    const rows = this.database.prepare(`
      SELECT id, public_id, name FROM projects
      WHERE workspace_id = ? AND deleted_at IS NULL ${filter}
    `).all(...params) as ProjectRow[]
    if (rows.length !== publicIds.length && publicIds.length > 0) throw new RangeError('Invalid project filter')
    return rows
  }

  private loadRepositories(publicIds: string[]): RepositoryRow[] {
    const params: Array<number | string> = [this.context.workspace_id]
    const filter = publicIds.length > 0 ? `AND repositories.public_id IN (${publicIds.map(() => '?').join(', ')})` : ''
    params.push(...publicIds)
    const rows = this.database.prepare(`
      SELECT repositories.id, repositories.public_id,
        CASE WHEN projects.deleted_at IS NULL THEN repositories.project_id ELSE NULL END AS project_id
      FROM repositories
      LEFT JOIN projects ON projects.id = repositories.project_id AND projects.workspace_id = repositories.workspace_id
      WHERE repositories.workspace_id = ? AND repositories.deleted_at IS NULL ${filter}
    `).all(...params) as RepositoryRow[]
    if (rows.length !== publicIds.length && publicIds.length > 0) throw new RangeError('Invalid repository filter')
    return rows
  }

  private assertWorkspace(): void {
    const row = this.database.prepare(`
      SELECT 1 FROM workspaces
      INNER JOIN users ON users.workspace_id = workspaces.id
      WHERE workspaces.id = ? AND users.id = ?
        AND workspaces.deleted_at IS NULL AND users.deleted_at IS NULL
    `).get(this.context.workspace_id, this.context.user_id)
    if (!row) throw new Error('Workspace not found')
  }
}

function previousCalendarDate(value: string): string {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10)
}

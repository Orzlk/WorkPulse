import type Database from 'better-sqlite3'

import type { InboxItem, Page, SearchResult } from '../domain/types'
import type { Pagination, WorkspaceContext } from '../repositories/contracts'
import { LocalInboxRepository } from '../repositories/localInboxRepository'
import { normalizeTagName } from '../repositories/localTagRepository'
import { buildFtsQuery } from '../search/ftsQuery'

export interface InboxSearchQuery extends Pagination {
  text?: string
  tag_names?: string[]
  project_id?: string | null
  state?: InboxItem['state']
}

/** state is evaluated only by the inbox branch; non-inbox entities have no compatible state field. */
export interface UnifiedSearchQuery extends Pagination {
  text?: string
  tag_names?: string[]
  project_id?: string | null
  repository_id?: string | null
  state?: InboxItem['state']
}

interface SearchFilterSpec {
  entityType: 'work_log' | 'task' | 'inbox_item' | 'git_commit' | 'report'
  textFields: string[]
  tagTable: 'work_log_tags' | 'task_tags' | 'inbox_tags' | 'git_commit_tags' | 'report_tags'
  tagColumn: 'work_log_id' | 'task_id' | 'inbox_item_id' | 'git_commit_id' | 'report_id'
  projectMatch: string
  projectUnassigned: string
  repositoryMatch: string
  repositoryUnassigned: string
  inboxState?: boolean
}

export class SearchService {
  constructor(
    private readonly database: Database.Database,
    private readonly context: WorkspaceContext,
    private readonly inbox = new LocalInboxRepository(database)
  ) {}

  searchInbox(query: InboxSearchQuery = {}): Page<InboxItem> {
    const page = this.searchInboxWithTextMode(query, 'fts')
    if (query.text?.trim() && page.total === 0) {
      return this.searchInboxWithTextMode(query, 'like')
    }
    return page
  }

  private searchInboxWithTextMode(query: InboxSearchQuery, textMode: 'fts' | 'like'): Page<InboxItem> {
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
    if (query.state) {
      conditions.push('inbox_items.state = ?')
      values.push(query.state)
    }
    if (query.text?.trim()) {
      if (textMode === 'fts') {
        conditions.push(`EXISTS (
          SELECT 1 FROM content_search
          WHERE content_search MATCH ?
            AND content_search.entity_type = 'inbox_item'
            AND content_search.entity_id = CAST(inbox_items.id AS TEXT)
            AND content_search.workspace_id = inbox_items.workspace_id
        )`)
        values.push(buildFtsQuery(query.text))
      } else {
        conditions.push(`EXISTS (
          SELECT 1 FROM content_search
          WHERE content_search.entity_type = 'inbox_item'
            AND content_search.entity_id = CAST(inbox_items.id AS TEXT)
            AND content_search.workspace_id = inbox_items.workspace_id
            AND content_search.content LIKE ?
        )`)
        values.push(`%${query.text.trim()}%`)
      }
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

  search(query: UnifiedSearchQuery = {}): Page<SearchResult> {
    const page = this.searchWithTextMode(query, 'fts')
    if (query.text?.trim() && page.total === 0) {
      return this.searchWithTextMode(query, 'like')
    }
    return page
  }

  private searchWithTextMode(query: UnifiedSearchQuery, textMode: 'fts' | 'like'): Page<SearchResult> {
    this.assertWorkspace()
    const text = query.text?.trim() ?? ''
    const like = `%${text}%`
    const tagSelect = (table: SearchFilterSpec['tagTable'], column: SearchFilterSpec['tagColumn']): string => `
      (SELECT GROUP_CONCAT(COALESCE(tags.display_path, tags.path), ',') FROM ${table} AS entity_tags
       INNER JOIN tags ON tags.id = entity_tags.tag_id
         AND tags.workspace_id = entity.workspace_id AND tags.deleted_at IS NULL
       WHERE entity_tags.${column} = entity.id) AS tag_paths`

    const entityRelation = (table: 'projects' | 'repositories', column: 'project_id' | 'repository_id'): { match: string; unassigned: string } => ({
      match: `EXISTS (
        SELECT 1 FROM ${table} AS filter_${table}
        WHERE filter_${table}.id = entity.${column}
          AND filter_${table}.workspace_id = entity.workspace_id
          AND filter_${table}.public_id = ? AND filter_${table}.deleted_at IS NULL
      )`,
      unassigned: `NOT EXISTS (
        SELECT 1 FROM ${table} AS filter_${table}
        WHERE filter_${table}.id = entity.${column}
          AND filter_${table}.workspace_id = entity.workspace_id
          AND filter_${table}.deleted_at IS NULL
      )`
    })

    const reportRelation = (table: 'projects' | 'repositories', linkTable: 'report_projects' | 'report_repositories', column: 'project_id' | 'repository_id'): { match: string; unassigned: string } => ({
      match: `EXISTS (
        SELECT 1 FROM ${linkTable} AS filter_links
        INNER JOIN ${table} AS filter_${table} ON filter_${table}.id = filter_links.${column}
        WHERE filter_links.report_id = entity.id
          AND filter_${table}.workspace_id = entity.workspace_id
          AND filter_${table}.public_id = ? AND filter_${table}.deleted_at IS NULL
      )`,
      unassigned: `NOT EXISTS (
        SELECT 1 FROM ${linkTable} AS filter_links
        INNER JOIN ${table} AS filter_${table} ON filter_${table}.id = filter_links.${column}
        WHERE filter_links.report_id = entity.id
          AND filter_${table}.workspace_id = entity.workspace_id
          AND filter_${table}.deleted_at IS NULL
      )`
    })

    const reportAggregate = (table: 'projects' | 'repositories', linkTable: 'report_projects' | 'report_repositories', column: 'project_id' | 'repository_id', field: 'public_id' | 'name'): string => `
      (SELECT GROUP_CONCAT(value, ',') FROM (
        SELECT DISTINCT related.${field} AS value
        FROM ${linkTable} AS report_links
        INNER JOIN ${table} AS related ON related.id = report_links.${column}
          AND related.workspace_id = entity.workspace_id AND related.deleted_at IS NULL
        WHERE report_links.report_id = entity.id
        ORDER BY related.public_id
      ))`

    const standardRelation = (table: 'projects' | 'repositories', column: 'project_id' | 'repository_id') => entityRelation(table, column)
    const reportProjectRelation = reportRelation('projects', 'report_projects', 'project_id')
    const reportRepositoryRelation = reportRelation('repositories', 'report_repositories', 'repository_id')
    const filters = (spec: SearchFilterSpec): { where: string; params: unknown[] } => {
      const where = ['entity.workspace_id = ?', 'entity.deleted_at IS NULL']
      const params: unknown[] = [this.context.workspace_id]
      if (text) {
        if (textMode === 'fts') {
          where.push(`EXISTS (
            SELECT 1 FROM content_search
            WHERE content_search MATCH ?
              AND content_search.entity_type = ?
              AND content_search.entity_id = CAST(entity.id AS TEXT)
              AND content_search.workspace_id = entity.workspace_id
          )`)
          params.push(buildFtsQuery(text), spec.entityType)
        } else {
          where.push(`(${spec.textFields.map((field) => `${field} LIKE ?`).join(' OR ')})`)
          params.push(...spec.textFields.map(() => like))
        }
      }
      if (query.project_id !== undefined) {
        where.push(query.project_id === null ? spec.projectUnassigned : spec.projectMatch)
        if (query.project_id !== null) params.push(query.project_id)
      }
      if (query.repository_id !== undefined) {
        where.push(query.repository_id === null ? spec.repositoryUnassigned : spec.repositoryMatch)
        if (query.repository_id !== null) params.push(query.repository_id)
      }
      if (spec.inboxState && query.state !== undefined) {
        where.push('entity.state = ?')
        params.push(query.state)
      }
      for (const tagName of query.tag_names ?? []) {
        const path = normalizeTagName(tagName)
        where.push(`EXISTS (
          SELECT 1 FROM ${spec.tagTable} AS filter_tags
          INNER JOIN tags AS filter_tag ON filter_tag.id = filter_tags.tag_id
          WHERE filter_tags.${spec.tagColumn} = entity.id
            AND filter_tag.workspace_id = entity.workspace_id
            AND filter_tag.deleted_at IS NULL
            AND (filter_tag.path = ? OR filter_tag.path LIKE ?)
        )`)
        params.push(path, `${path}/%`)
      }
      return { where: where.join(' AND '), params }
    }

    const projectRelation = standardRelation('projects', 'project_id')
    const repositoryRelation = standardRelation('repositories', 'repository_id')
    const workItemRepositoryRelation = { match: '? IS NULL', unassigned: '1 = 1' }
    const workLogFilters = filters({
      entityType: 'work_log',
      textFields: ['entity.content', 'entity.category'], tagTable: 'work_log_tags', tagColumn: 'work_log_id',
      projectMatch: projectRelation.match, projectUnassigned: projectRelation.unassigned,
      repositoryMatch: workItemRepositoryRelation.match, repositoryUnassigned: workItemRepositoryRelation.unassigned
    })
    const taskFilters = filters({
      entityType: 'task',
      textFields: ['entity.title', 'entity.description'], tagTable: 'task_tags', tagColumn: 'task_id',
      projectMatch: projectRelation.match, projectUnassigned: projectRelation.unassigned,
      repositoryMatch: workItemRepositoryRelation.match, repositoryUnassigned: workItemRepositoryRelation.unassigned
    })
    const inboxFilters = filters({
      entityType: 'inbox_item',
      textFields: ['entity.content'], tagTable: 'inbox_tags', tagColumn: 'inbox_item_id', inboxState: true,
      projectMatch: projectRelation.match, projectUnassigned: projectRelation.unassigned,
      repositoryMatch: workItemRepositoryRelation.match, repositoryUnassigned: workItemRepositoryRelation.unassigned
    })
    const gitRepositoryRelation = standardRelation('repositories', 'repository_id')
    const gitProjectRelation = {
      match: `EXISTS (
        SELECT 1 FROM repositories AS filter_git_repositories
        INNER JOIN projects AS filter_git_projects ON filter_git_projects.id = filter_git_repositories.project_id
        WHERE filter_git_repositories.id = entity.repository_id
          AND filter_git_repositories.workspace_id = entity.workspace_id
          AND filter_git_projects.workspace_id = entity.workspace_id
          AND filter_git_projects.public_id = ? AND filter_git_projects.deleted_at IS NULL
          AND filter_git_repositories.deleted_at IS NULL
      )`,
      unassigned: `NOT EXISTS (
        SELECT 1 FROM repositories AS filter_git_repositories
        INNER JOIN projects AS filter_git_projects ON filter_git_projects.id = filter_git_repositories.project_id
        WHERE filter_git_repositories.id = entity.repository_id
          AND filter_git_repositories.workspace_id = entity.workspace_id
          AND filter_git_projects.workspace_id = entity.workspace_id
          AND filter_git_projects.deleted_at IS NULL
          AND filter_git_repositories.deleted_at IS NULL
      )`
    }
    const gitFilters = filters({
      entityType: 'git_commit',
      textFields: ['entity.message', 'entity.commit_hash'], tagTable: 'git_commit_tags', tagColumn: 'git_commit_id',
      projectMatch: gitProjectRelation.match, projectUnassigned: gitProjectRelation.unassigned,
      repositoryMatch: gitRepositoryRelation.match, repositoryUnassigned: gitRepositoryRelation.unassigned
    })
    const reportFilters = filters({
      entityType: 'report',
      textFields: ['entity.content', 'entity.type'], tagTable: 'report_tags', tagColumn: 'report_id',
      projectMatch: reportProjectRelation.match, projectUnassigned: reportProjectRelation.unassigned,
      repositoryMatch: reportRepositoryRelation.match, repositoryUnassigned: reportRepositoryRelation.unassigned
    })

    const sources = [
      {
        sql: `SELECT 'work_log' AS source, entity.public_id, entity.content AS title, entity.content AS excerpt, entity.created_at AS time,
        projects.public_id AS project_id, projects.name AS project_name,
        NULL AS repository_id, NULL AS repository_name,
        ${tagSelect('work_log_tags', 'work_log_id')}
      FROM work_logs AS entity
      LEFT JOIN projects ON projects.id = entity.project_id AND projects.workspace_id = entity.workspace_id AND projects.deleted_at IS NULL
      WHERE ${workLogFilters.where}
      `,
        params: workLogFilters.params
      },
      {
        sql: `SELECT 'task' AS source, entity.public_id, entity.title, COALESCE(NULLIF(entity.description, ''), entity.title) AS excerpt,
        entity.created_at AS time, projects.public_id AS project_id, projects.name AS project_name,
        NULL AS repository_id, NULL AS repository_name,
        ${tagSelect('task_tags', 'task_id')}
      FROM tasks AS entity
      LEFT JOIN projects ON projects.id = entity.project_id AND projects.workspace_id = entity.workspace_id AND projects.deleted_at IS NULL
      WHERE ${taskFilters.where}
      `,
        params: taskFilters.params
      },
      {
        sql: `SELECT 'inbox' AS source, entity.public_id, entity.content AS title, entity.content AS excerpt, entity.created_at AS time,
        projects.public_id AS project_id, projects.name AS project_name,
        NULL AS repository_id, NULL AS repository_name,
        ${tagSelect('inbox_tags', 'inbox_item_id')}
      FROM inbox_items AS entity
      LEFT JOIN projects ON projects.id = entity.project_id AND projects.workspace_id = entity.workspace_id AND projects.deleted_at IS NULL
      WHERE ${inboxFilters.where}
      `,
        params: inboxFilters.params
      },
      {
        sql: `SELECT 'git_commit' AS source, entity.public_id, entity.message AS title, entity.message AS excerpt, entity.committed_at AS time,
        projects.public_id AS project_id, projects.name AS project_name,
        repositories.public_id AS repository_id, repositories.name AS repository_name,
        ${tagSelect('git_commit_tags', 'git_commit_id')}
      FROM git_commits AS entity
      INNER JOIN repositories ON repositories.id = entity.repository_id
        AND repositories.workspace_id = entity.workspace_id AND repositories.deleted_at IS NULL
      LEFT JOIN projects ON projects.id = repositories.project_id
        AND projects.workspace_id = repositories.workspace_id AND projects.deleted_at IS NULL
      WHERE ${gitFilters.where}
      `,
        params: gitFilters.params
      },
      {
        sql: `SELECT 'report' AS source, entity.public_id, entity.type || ' report' AS title, entity.content AS excerpt,
        COALESCE(entity.generated_at, entity.updated_at) AS time,
        ${reportAggregate('projects', 'report_projects', 'project_id', 'public_id')} AS project_id,
        ${reportAggregate('projects', 'report_projects', 'project_id', 'name')} AS project_name,
        ${reportAggregate('repositories', 'report_repositories', 'repository_id', 'public_id')} AS repository_id,
        ${reportAggregate('repositories', 'report_repositories', 'repository_id', 'name')} AS repository_name,
        ${tagSelect('report_tags', 'report_id')}
      FROM reports AS entity
      WHERE ${reportFilters.where}
      `,
        params: reportFilters.params
      }
    ]
    const unionSql = sources.map((source) => source.sql).join('\nUNION ALL\n')
    const values = sources.flatMap((source) => source.params)
    const offset = Math.max(query.offset ?? 0, 0)
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200)
    const rows = this.database.prepare(`
      SELECT source, public_id, title, excerpt, project_id, project_name,
        repository_id, repository_name, tag_paths, time
      FROM (${unionSql}) AS search_results
      ORDER BY time DESC, public_id DESC
      LIMIT ? OFFSET ?
    `).all(...values, limit, offset) as Array<Record<string, unknown>>
    const total = this.database.prepare(`
      SELECT COUNT(*) AS count FROM (${unionSql}) AS search_results
    `).get(...values) as { count: number }
    return {
      items: rows.map((row) => this.toSearchResult(row.source as SearchResult['source'], row)),
      total: total.count
    }
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

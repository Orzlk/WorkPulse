import { randomUUID } from 'node:crypto'

import type Database from 'better-sqlite3'

import {
  GitScanner,
  type GitCommitSummary,
  type GitRepository,
  type RepositoryBinding
} from '../git/gitScanner'
import type { Page } from '../domain/types'
import type { Pagination, WorkspaceContext } from '../repositories/contracts'
import { enqueueOutbox } from '../sync/outbox'

const DEFAULT_LIMIT = 50
const INITIAL_SCAN_WINDOW_MS = 30 * 24 * 60 * 60 * 1000
const INCREMENTAL_OVERLAP_MS = 5 * 60 * 1000
const activeRepositoryScans = new Set<string>()

export interface Repository {
  public_id: string
  name: string
  remote_url: string | null
  project_id: string | null
  local_path: string
  branch: string | null
  enabled: boolean
  scan_interval_minutes: number | null
  last_scanned_at: string | null
  last_failed_at: string | null
  last_scan_error: string | null
}

interface RepositoryRow extends Repository {
  id: number
  binding_id: number
}

export interface CreateRepositoryInput {
  name: string
  local_path: string
  remote_url?: string | null
  project_id?: string | null
  enabled?: boolean
  scan_interval_minutes?: number | null
}

export interface UpdateRepositoryInput {
  name?: string
  local_path?: string
  remote_url?: string | null
  project_id?: string | null
  enabled?: boolean
  scan_interval_minutes?: number | null
}

export interface RepositoryScanResult {
  repository_id: string
  status: 'succeeded' | 'failed' | 'skipped'
  inserted_count: number
  error?: string
}

function resolvePagination(pagination: Pagination = {}): Required<Pagination> {
  return {
    limit: Math.min(Math.max(pagination.limit ?? DEFAULT_LIMIT, 1), 200),
    offset: Math.max(pagination.offset ?? 0, 0)
  }
}

function toRepository(row: RepositoryRow): Repository {
  return {
    public_id: row.public_id,
    name: row.name,
    remote_url: row.remote_url,
    project_id: row.project_id,
    local_path: row.local_path,
    branch: row.branch,
    enabled: Boolean(row.enabled),
    scan_interval_minutes: row.scan_interval_minutes,
    last_scanned_at: row.last_scanned_at,
    last_failed_at: row.last_failed_at,
    last_scan_error: row.last_scan_error
  }
}

function normalizeNow(value?: string): string {
  const date = value ? new Date(value) : new Date()
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

export class RepositoryService {
  constructor(
    private readonly database: Database.Database,
    private readonly context: WorkspaceContext,
    private readonly scanner = new GitScanner()
  ) {}

  list(pagination?: Pagination): Page<Repository> {
    this.assertWorkspace()
    const { limit, offset } = resolvePagination(pagination)
    const items = this.database.prepare(`${this.repositorySelect}
      WHERE repositories.workspace_id = ? AND repositories.deleted_at IS NULL
      ORDER BY repositories.updated_at DESC, repositories.id DESC
      LIMIT ? OFFSET ?
    `).all(this.context.workspace_id, limit, offset) as RepositoryRow[]
    const total = this.database.prepare(`
      SELECT COUNT(*) AS count FROM repositories
      WHERE workspace_id = ? AND deleted_at IS NULL
    `).get(this.context.workspace_id) as { count: number }
    return { items: items.map(toRepository), total: total.count }
  }

  get(publicId: string): Repository | null {
    this.assertWorkspace()
    const row = this.findRow(publicId)
    return row ? toRepository(row) : null
  }

  create(input: CreateRepositoryInput): Repository {
    this.assertWorkspace()
    const name = input.name.trim()
    const localPath = input.local_path.trim()
    if (!name) throw new Error('Repository name is required')
    if (!localPath) throw new Error('Repository local path is required')
    if (input.scan_interval_minutes !== undefined && input.scan_interval_minutes !== null && input.scan_interval_minutes <= 0) {
      throw new Error('Repository scan interval must be positive')
    }
    this.assertProject(input.project_id ?? null)

    const create = this.database.transaction(() => {
      const now = new Date().toISOString()
      const publicId = randomUUID()
      const result = this.database.prepare(`
        INSERT INTO repositories (
          public_id, workspace_id, project_id, name, remote_url, enabled, scan_interval_minutes,
          created_by, updated_by, created_at, updated_at
        ) VALUES (
          ?, ?,
          (SELECT id FROM projects WHERE workspace_id = ? AND public_id = ? AND deleted_at IS NULL),
          ?, ?, ?, ?, ?, ?, ?, ?
        )
      `).run(
        publicId,
        this.context.workspace_id,
        this.context.workspace_id,
        input.project_id ?? null,
        name,
        input.remote_url?.trim() || null,
        Number(input.enabled ?? true),
        input.scan_interval_minutes ?? null,
        this.context.user_id,
        this.context.user_id,
        now,
        now
      )
      const repositoryId = Number(result.lastInsertRowid)
      this.database.prepare(`
        INSERT INTO repository_bindings (
          public_id, repository_id, workspace_id, local_path, created_by, updated_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(randomUUID(), repositoryId, this.context.workspace_id, localPath, this.context.user_id, this.context.user_id, now, now)
      const row = this.findRow(publicId)
      if (!row) throw new Error('Repository creation failed')
      const repository = toRepository(row)
      this.enqueueSync('repository', repository.public_id, 'create', repository, now)
      return repository
    })
    return create()
  }

  assignProject(publicId: string, projectId: string | null): Repository | null {
    return this.update(publicId, { project_id: projectId })
  }

  setEnabled(publicId: string, enabled: boolean): Repository | null {
    return this.update(publicId, { enabled })
  }

  update(publicId: string, input: UpdateRepositoryInput): Repository | null {
    this.assertWorkspace()
    const name = input.name === undefined ? undefined : input.name.trim()
    const localPath = input.local_path === undefined ? undefined : input.local_path.trim()
    if (input.name !== undefined && !name) throw new Error('Repository name is required')
    if (input.local_path !== undefined && !localPath) throw new Error('Repository local path is required')
    if (input.project_id !== undefined) this.assertProject(input.project_id)
    if (input.scan_interval_minutes !== undefined && input.scan_interval_minutes !== null && input.scan_interval_minutes <= 0) {
      throw new Error('Repository scan interval must be positive')
    }
    const fields: string[] = []
    const values: unknown[] = []
    if (name !== undefined) {
      fields.push('name = ?')
      values.push(name)
    }
    if (input.remote_url !== undefined) {
      fields.push('remote_url = ?')
      values.push(input.remote_url?.trim() || null)
    }
    if (input.project_id !== undefined) {
      fields.push('project_id = (SELECT id FROM projects WHERE workspace_id = ? AND public_id = ? AND deleted_at IS NULL)')
      values.push(this.context.workspace_id, input.project_id)
    }
    if (input.enabled !== undefined) {
      fields.push('enabled = ?')
      values.push(Number(input.enabled))
    }
    if (input.scan_interval_minutes !== undefined) {
      fields.push('scan_interval_minutes = ?')
      values.push(input.scan_interval_minutes)
    }
    const currentRepository = localPath === undefined ? null : this.findRow(publicId)
    const hasBindingUpdate = localPath !== undefined && currentRepository?.local_path !== localPath
    if (fields.length === 0 && !hasBindingUpdate) return this.get(publicId)

    const now = new Date().toISOString()
    const transaction = this.database.transaction(() => {
      if (hasBindingUpdate) {
        fields.push('last_scanned_at = NULL', 'last_failed_at = NULL', 'last_scan_error = NULL')
      }
      if (fields.length > 0) {
        this.database.prepare(`
          UPDATE repositories SET ${fields.join(', ')}, updated_by = ?, updated_at = ?
          WHERE workspace_id = ? AND public_id = ? AND deleted_at IS NULL
        `).run(...values, this.context.user_id, now, this.context.workspace_id, publicId)
      }
      if (hasBindingUpdate) {
        const repository = this.findRow(publicId)
        if (!repository) return null
        this.database.prepare(`
          UPDATE repository_bindings
          SET local_path = ?, branch = NULL, updated_by = ?, updated_at = ?
          WHERE id = ? AND repository_id = ? AND workspace_id = ? AND deleted_at IS NULL
        `).run(localPath, this.context.user_id, now, repository.binding_id, repository.id, this.context.workspace_id)
      }
      const row = this.findRow(publicId)
      if (!row) return null
      const repository = toRepository(row)
      this.enqueueSync('repository', repository.public_id, 'update', repository, now)
      return repository
    })
    return transaction()
  }

  softDelete(publicId: string): Repository | null {
    this.assertWorkspace()
    const transaction = this.database.transaction(() => {
      const row = this.findRow(publicId)
      if (!row) return null
      const now = new Date().toISOString()
      this.database.prepare(`
        UPDATE repositories
        SET deleted_at = ?, updated_by = ?, updated_at = ?
        WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL
      `).run(now, this.context.user_id, now, row.id, this.context.workspace_id)
      this.database.prepare(`
        UPDATE repository_bindings
        SET deleted_at = ?, updated_by = ?, updated_at = ?
        WHERE repository_id = ? AND workspace_id = ? AND deleted_at IS NULL
      `).run(now, this.context.user_id, now, row.id, this.context.workspace_id)
      const repository = toRepository(row)
      this.enqueueSync('repository', repository.public_id, 'delete', { ...repository, deleted_at: now }, now)
      return repository
    })
    return transaction()
  }

  async scanOne(publicId: string, nowValue?: string): Promise<RepositoryScanResult> {
    this.assertWorkspace()
    const repository = this.findRow(publicId)
    if (!repository) throw new Error('Repository not found')
    if (!repository.enabled) return { repository_id: publicId, status: 'skipped', inserted_count: 0 }
    const scanLock = `${this.context.workspace_id}:${repository.id}`
    if (activeRepositoryScans.has(scanLock)) return { repository_id: publicId, status: 'skipped', inserted_count: 0 }

    activeRepositoryScans.add(scanLock)
    const now = normalizeNow(nowValue)
    try {
      const scan = await this.scanner.scan(
        { id: repository.id, public_id: repository.public_id } satisfies GitRepository,
        {
          id: repository.binding_id,
          repository_id: repository.id,
          local_path: repository.local_path,
          branch: repository.branch
        } satisfies RepositoryBinding,
        { since: this.getSince(repository.last_scanned_at, now), until: now }
      )
      const insertedCount = this.persistScan(repository, scan.commits, scan.branch, now)
      return { repository_id: publicId, status: 'succeeded', inserted_count: insertedCount }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Git 扫描失败'
      this.database.prepare(`
        UPDATE repositories
        SET last_failed_at = ?, last_scan_error = ?, updated_by = ?, updated_at = ?
        WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL
      `).run(now, message, this.context.user_id, now, repository.id, this.context.workspace_id)
      return { repository_id: publicId, status: 'failed', inserted_count: 0, error: message }
    } finally {
      activeRepositoryScans.delete(scanLock)
    }
  }

  async scanAllEnabled(nowValue?: string): Promise<RepositoryScanResult[]> {
    this.assertWorkspace()
    const repositories = this.database.prepare(`
      SELECT public_id, scan_interval_minutes, last_scanned_at FROM repositories
      WHERE workspace_id = ? AND enabled = 1 AND deleted_at IS NULL
      ORDER BY id
    `).all(this.context.workspace_id) as Array<{
      public_id: string
      scan_interval_minutes: number | null
      last_scanned_at: string | null
    }>
    const now = normalizeNow(nowValue)
    const results: RepositoryScanResult[] = []
    for (const repository of repositories) {
      if (this.shouldWaitForNextScan(repository.last_scanned_at, repository.scan_interval_minutes, now)) {
        results.push({ repository_id: repository.public_id, status: 'skipped', inserted_count: 0 })
        continue
      }
      results.push(await this.scanOne(repository.public_id, now))
    }
    return results
  }

  private get repositorySelect(): string {
    return `
      SELECT repositories.id, repositories.public_id, repositories.name, repositories.remote_url,
        projects.public_id AS project_id, repositories.enabled, repositories.scan_interval_minutes,
        repositories.last_scanned_at, repositories.last_failed_at, repositories.last_scan_error,
        repository_bindings.id AS binding_id, repository_bindings.local_path, repository_bindings.branch
      FROM repositories
      LEFT JOIN projects ON projects.id = repositories.project_id
        AND projects.workspace_id = repositories.workspace_id
        AND projects.deleted_at IS NULL
      INNER JOIN repository_bindings ON repository_bindings.id = (
        SELECT id FROM repository_bindings
        WHERE repository_id = repositories.id AND deleted_at IS NULL
        ORDER BY id DESC LIMIT 1
      )
    `
  }

  private findRow(publicId: string): RepositoryRow | null {
    const row = this.database.prepare(`${this.repositorySelect}
      WHERE repositories.workspace_id = ? AND repositories.public_id = ? AND repositories.deleted_at IS NULL
    `).get(this.context.workspace_id, publicId) as RepositoryRow | undefined
    return row ?? null
  }

  private getSince(lastScannedAt: string | null, now: string): string {
    const nowMs = Date.parse(now)
    const lastMs = lastScannedAt ? Date.parse(lastScannedAt) : Number.NaN
    if (!Number.isFinite(lastMs) || lastMs > nowMs) {
      return new Date(nowMs - INITIAL_SCAN_WINDOW_MS).toISOString()
    }
    return new Date(lastMs - INCREMENTAL_OVERLAP_MS).toISOString()
  }

  private shouldWaitForNextScan(lastScannedAt: string | null, intervalMinutes: number | null, now: string): boolean {
    if (!intervalMinutes || !lastScannedAt) return false
    const lastMs = Date.parse(lastScannedAt)
    const nowMs = Date.parse(now)
    if (!Number.isFinite(lastMs) || !Number.isFinite(nowMs) || lastMs > nowMs) return false
    return nowMs - lastMs < intervalMinutes * 60 * 1000
  }

  private persistScan(repository: RepositoryRow, commits: GitCommitSummary[], branch: string | null, now: string): number {
    const persist = this.database.transaction(() => {
      const insert = this.database.prepare(`
        INSERT OR IGNORE INTO git_commits (
          public_id, workspace_id, repository_id, commit_hash, author_name, author_email,
          committed_at, message, branch, files_changed, additions, deletions,
          created_by, updated_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      let insertedCount = 0
      for (const commit of commits) {
        const commitPublicId = randomUUID()
        const result = insert.run(
          commitPublicId,
          this.context.workspace_id,
          repository.id,
          commit.commit_hash,
          commit.author_name,
          commit.author_email,
          commit.committed_at,
          commit.subject,
          commit.branch,
          commit.file_count,
          commit.additions,
          commit.deletions,
          this.context.user_id,
          this.context.user_id,
          now,
          now
        )
        if (result.changes > 0) {
          insertedCount += 1
          this.enqueueSync(
            'git_commit',
            commitPublicId,
            'create',
            { ...commit, repository_id: repository.public_id },
            now
          )
        }
      }
      this.database.prepare(`
        UPDATE repository_bindings
        SET branch = ?, updated_by = ?, updated_at = ?
        WHERE id = ? AND repository_id = ? AND workspace_id = ? AND deleted_at IS NULL
      `).run(branch || 'HEAD', this.context.user_id, now, repository.binding_id, repository.id, this.context.workspace_id)
      this.database.prepare(`
        UPDATE repositories
        SET last_scanned_at = ?, last_failed_at = NULL, last_scan_error = NULL,
          updated_by = ?, updated_at = ?
        WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL
      `).run(now, this.context.user_id, now, repository.id, this.context.workspace_id)
      return insertedCount
    })
    return persist()
  }

  private assertWorkspace(): void {
    const workspace = this.database.prepare(`
      SELECT 1 FROM workspaces
      INNER JOIN users ON users.workspace_id = workspaces.id
      WHERE workspaces.id = ? AND users.id = ?
        AND workspaces.deleted_at IS NULL AND users.deleted_at IS NULL
    `).get(this.context.workspace_id, this.context.user_id)
    if (!workspace) throw new Error('Workspace not found')
  }

  private assertProject(projectId: string | null): void {
    if (projectId === null) return
    const project = this.database.prepare(`
      SELECT 1 FROM projects
      WHERE workspace_id = ? AND public_id = ? AND deleted_at IS NULL
    `).get(this.context.workspace_id, projectId)
    if (!project) throw new Error('Project not found')
  }

  private enqueueSync(
    entityType: string,
    entityPublicId: string,
    operationType: 'create' | 'update' | 'delete',
    payload: unknown,
    now: string
  ): void {
    enqueueOutbox(this.database, this.context.workspace_id, {
      entity: entityType,
      publicId: entityPublicId,
      operationType,
      changedAt: now,
      data: payload
    })
  }
}

export class RepositoryScheduler {
  private timer: NodeJS.Timeout | null = null
  private running = false

  constructor(
    private readonly repositories: RepositoryService,
    private readonly intervalMs: number
  ) {}

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => {
      if (this.timer) void this.tick().catch((error: unknown) => console.error('Repository scheduler tick failed', error))
    }, this.intervalMs)
  }

  stop(): void {
    if (!this.timer) return
    clearInterval(this.timer)
    this.timer = null
  }

  async tick(): Promise<RepositoryScanResult[]> {
    if (this.running) return []
    this.running = true
    try {
      return await this.repositories.scanAllEnabled()
    } finally {
      this.running = false
    }
  }
}

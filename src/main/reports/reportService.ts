import { randomUUID } from 'node:crypto'

import type Database from 'better-sqlite3'

import type { WorkspaceContext } from '../repositories/contracts'
import { ReportQueryService } from './reportQueryService'
import type {
  LegacyReportSourceSnapshot,
  ReportRequest,
  ReportSnapshot,
  ReportSourceSnapshot,
  SavedPeriodReport
} from './reportTypes'

interface ReportGenerator {
  generateContent(snapshot: ReportSourceSnapshot, request: ReportRequest): Promise<string>
}

interface ReportRow {
  public_id: string
  type: string
  period_start: string
  period_end_exclusive: string
  timezone: string
  project_scope: string
  repository_scope: string
  source_snapshot: string
  content: string
  version: number
  status: 'generating' | 'ready' | 'error'
  error_message: string | null
  retry_count: number
  generated_at: string | null
  updated_at: string
}

export class ReportService {
  private readonly query: ReportQueryService

  constructor(
    private readonly database: Database.Database,
    private readonly context: WorkspaceContext,
    private readonly generator: ReportGenerator = {
      generateContent: async (snapshot, request) => {
        const { generatePeriodReportContent } = await import('../ai')
        return generatePeriodReportContent(snapshot, request.type, snapshot.period)
      }
    }
  ) {
    this.query = new ReportQueryService(database, context)
  }

  async generate(request: ReportRequest): Promise<SavedPeriodReport> {
    const snapshot = this.query.buildSnapshot(request)
    const now = new Date().toISOString()
    const projectScope = JSON.stringify([...(request.projectIds ?? [])].sort())
    const repositoryScope = JSON.stringify([...(request.repositoryIds ?? [])].sort())
    const created = this.database.transaction(() => this.createGeneratingReport(snapshot, request, projectScope, repositoryScope, now))()

    try {
      const content = await this.generator.generateContent(snapshot, request)
      if (!content.trim()) throw new Error('AI response content is empty')
      return this.database.transaction(() => this.finishReport(created.public_id, content.trim(), now))()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'AI report generation failed'
      this.database.transaction(() => this.failReport(created.public_id, message, now))()
      throw new Error(message)
    }
  }

  list(limit = 50): SavedPeriodReport[] {
    this.assertWorkspace()
    const rows = this.database.prepare(`
      SELECT public_id, type, period_start, period_end_exclusive, timezone, project_scope, repository_scope,
        source_snapshot, content, version, status, error_message, retry_count, generated_at, updated_at
      FROM reports
      WHERE workspace_id = ? AND deleted_at IS NULL
      ORDER BY period_start DESC, version DESC, id DESC
      LIMIT ?
    `).all(this.context.workspace_id, Math.min(Math.max(limit, 1), 200)) as ReportRow[]
    return rows.map((row) => this.toSavedReport(row))
  }

  get(publicId: string): SavedPeriodReport | null {
    this.assertWorkspace()
    const row = this.database.prepare(`
      SELECT public_id, type, period_start, period_end_exclusive, timezone, project_scope, repository_scope,
        source_snapshot, content, version, status, error_message, retry_count, generated_at, updated_at
      FROM reports
      WHERE public_id = ? AND workspace_id = ? AND deleted_at IS NULL
    `).get(publicId, this.context.workspace_id) as ReportRow | undefined
    return row ? this.toSavedReport(row) : null
  }

  updateContent(publicId: string, content: string): SavedPeriodReport | null {
    this.assertWorkspace()
    if (!content.trim()) throw new Error('Report content is required')
    const now = new Date().toISOString()
    const update = this.database.transaction(() => {
      const row = this.database.prepare(`
        UPDATE reports
        SET content = ?, status = 'ready', error_message = NULL, updated_by = ?, updated_at = ?
        WHERE public_id = ? AND workspace_id = ? AND deleted_at IS NULL
        RETURNING public_id, type, period_start, period_end_exclusive, timezone, project_scope, repository_scope,
          source_snapshot, content, version, status, error_message, retry_count, generated_at, updated_at
      `).get(content.trim(), this.context.user_id, now, publicId, this.context.workspace_id) as ReportRow | undefined
      if (!row) return null
      this.enqueueSync(row.public_id, 'update', row, now)
      return this.toSavedReport(row)
    })
    return update()
  }

  private createGeneratingReport(
    snapshot: ReportSourceSnapshot,
    request: ReportRequest,
    projectScope: string,
    repositoryScope: string,
    now: string
  ): ReportRow {
    const version = this.database.prepare(`
      SELECT COALESCE(MAX(version), 0) + 1 AS version FROM reports
      WHERE workspace_id = ? AND type = ? AND period_start = ? AND period_end_exclusive = ?
        AND project_scope = ? AND repository_scope = ? AND deleted_at IS NULL
    `).get(
      this.context.workspace_id,
      request.type,
      snapshot.period.fromUtc,
      snapshot.period.toUtc,
      projectScope,
      repositoryScope
    ) as { version: number }
    const row = this.database.prepare(`
      INSERT INTO reports (
        public_id, workspace_id, type, period_type, date_from, date_to, period_start, period_end_exclusive,
        time_zone, timezone, project_scope, repository_scope, source_snapshot, content, version, status,
        created_by, updated_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, 'generating', ?, ?, ?, ?)
      RETURNING public_id, type, period_start, period_end_exclusive, timezone, project_scope, repository_scope,
        source_snapshot, content, version, status, error_message, retry_count, generated_at, updated_at
    `).get(
      randomUUID(), this.context.workspace_id, request.type, request.type,
      snapshot.period.startDate, snapshot.period.endDateExclusive,
      snapshot.period.fromUtc, snapshot.period.toUtc,
      request.timeZone, request.timeZone, projectScope, repositoryScope, JSON.stringify(snapshot), version.version,
      this.context.user_id, this.context.user_id, now, now
    ) as ReportRow
    this.enqueueSync(row.public_id, 'create', row, now)
    return row
  }

  private finishReport(publicId: string, content: string, now: string): SavedPeriodReport {
    const row = this.database.prepare(`
      UPDATE reports
      SET content = ?, status = 'ready', error_message = NULL, generated_at = ?, updated_by = ?, updated_at = ?
      WHERE public_id = ? AND workspace_id = ? AND deleted_at IS NULL
      RETURNING public_id, type, period_start, period_end_exclusive, timezone, project_scope, repository_scope,
        source_snapshot, content, version, status, error_message, retry_count, generated_at, updated_at
    `).get(content, now, this.context.user_id, now, publicId, this.context.workspace_id) as ReportRow | undefined
    if (!row) throw new Error('Report not found')
    this.enqueueSync(row.public_id, 'update', row, now)
    return this.toSavedReport(row)
  }

  private failReport(publicId: string, message: string, now: string): void {
    const row = this.database.prepare(`
      UPDATE reports
      SET status = 'error', error_message = ?, retry_count = retry_count + 1, updated_by = ?, updated_at = ?
      WHERE public_id = ? AND workspace_id = ? AND deleted_at IS NULL
      RETURNING public_id, type, period_start, period_end_exclusive, timezone, project_scope, repository_scope,
        source_snapshot, content, version, status, error_message, retry_count, generated_at, updated_at
    `).get(message, this.context.user_id, now, publicId, this.context.workspace_id) as ReportRow | undefined
    if (row) this.enqueueSync(row.public_id, 'update', row, now)
  }

  private toSavedReport(row: ReportRow): SavedPeriodReport {
    return {
      ...row,
      period_end: row.period_end_exclusive,
      project_scope: JSON.parse(row.project_scope) as string[],
      repository_scope: JSON.parse(row.repository_scope) as string[],
      source_snapshot: this.parseSnapshot(row)
    }
  }

  private parseSnapshot(row: ReportRow): ReportSnapshot {
    let parsed: unknown
    try {
      parsed = JSON.parse(row.source_snapshot)
    } catch {
      parsed = null
    }
    if (this.isReportSourceSnapshot(parsed)) return parsed
    if (this.isLegacyReportSourceSnapshot(parsed)) return parsed
    return {
      schema_version: 'legacy',
      unavailable: true,
      projects: [],
      report_public_id: row.public_id,
      report_type: row.type,
      period_start: row.period_start || null,
      period_end: row.period_end_exclusive || null,
      timezone: row.timezone || null,
      reason: 'source_snapshot_unavailable'
    }
  }

  private isReportSourceSnapshot(value: unknown): value is ReportSourceSnapshot {
    return Boolean(
      value && typeof value === 'object' &&
      (value as { schema_version?: unknown }).schema_version === 1 &&
      Array.isArray((value as { projects?: unknown }).projects)
    )
  }

  private isLegacyReportSourceSnapshot(value: unknown): value is LegacyReportSourceSnapshot {
    return Boolean(
      value && typeof value === 'object' &&
      (value as { schema_version?: unknown }).schema_version === 'legacy' &&
      (value as { unavailable?: unknown }).unavailable === true &&
      Array.isArray((value as { projects?: unknown }).projects)
    )
  }

  private enqueueSync(entityPublicId: string, operationType: 'create' | 'update', payload: unknown, now: string): void {
    this.database.prepare(`
      INSERT INTO sync_operations (
        public_id, workspace_id, entity_type, entity_public_id, operation_type, payload, created_at, updated_at
      ) VALUES (?, ?, 'report', ?, ?, ?, ?, ?)
    `).run(randomUUID(), this.context.workspace_id, entityPublicId, operationType, JSON.stringify(payload), now, now)
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

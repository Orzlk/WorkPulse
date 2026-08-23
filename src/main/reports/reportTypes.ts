import type { ReportPeriod, ReportType } from '../lib/period'

export interface ReportRequest {
  type: ReportType
  anchorDate: string
  timeZone: string
  projectIds?: string[]
  repositoryIds?: string[]
}

export interface ReportLogSnapshot {
  public_id: string
  content: string
  created_at: string
  tags: string[]
}

export interface ReportTaskSnapshot {
  public_id: string
  title: string
  description: string
  status: string
  created_at: string
  completed_at: string | null
  tags: string[]
}

export interface ReportInboxSnapshot {
  public_id: string
  content: string
  created_at: string
  tags: string[]
}

export interface ReportGitCommitSnapshot {
  public_id: string
  repository_id: string
  commit_hash: string
  committed_at: string
  subject: string
  branch: string | null
  files_changed: number
  additions: number
  deletions: number
}

export interface ReportProjectSnapshot {
  public_id: string | null
  name: string
  work_logs: ReportLogSnapshot[]
  tasks: ReportTaskSnapshot[]
  inbox_items: ReportInboxSnapshot[]
  git_commits: ReportGitCommitSnapshot[]
}

export interface ReportSourceSnapshot {
  schema_version: 1
  period: ReportPeriod
  projects: ReportProjectSnapshot[]
}

export interface LegacyReportSourceSnapshot {
  schema_version: 'legacy'
  unavailable: true
  projects: []
  report_public_id: string
  report_type: string
  period_start: string | null
  period_end: string | null
  timezone: string | null
  reason: 'source_snapshot_unavailable'
}

export type ReportSnapshot = ReportSourceSnapshot | LegacyReportSourceSnapshot

export interface SavedPeriodReport {
  public_id: string
  type: string
  period_start: string
  period_end: string
  timezone: string
  project_scope: string[]
  repository_scope: string[]
  source_snapshot: ReportSnapshot
  content: string
  version: number
  status: 'generating' | 'ready' | 'error'
  error_message: string | null
  retry_count: number
  generated_at: string | null
  updated_at: string
}

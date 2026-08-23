import { getReportAnchorDate } from './reportPeriod'

export type WorkflowReportType = 'weekly' | 'monthly'
export type ReportGenerationError = 'no_key' | 'timeout' | 'invalid_response' | 'unknown'

export interface RetryReportRequest {
  type: WorkflowReportType
  anchorDate: string
  timeZone: string
  projectIds: string[]
  repositoryIds: string[]
}

interface HistoricalReport {
  type: string
  display_start: string
  timezone: string
  project_scope: string[]
  repository_scope: string[]
  status: 'generating' | 'ready' | 'error'
  error_message: string | null
  retry_count: number
}

interface ExportableReport {
  type: string
  display_start: string
  display_end_inclusive: string
}

function shiftCalendarDate(value: string, days: number): string {
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + days))
  return date.toISOString().slice(0, 10)
}

function startOfCalendarMonth(value: string): string {
  return `${value.slice(0, 7)}-01`
}

export function getLatestCompleteReportAnchor(
  type: WorkflowReportType,
  timeZone: string,
  now: Date = new Date()
): string {
  const localDate = getReportAnchorDate(timeZone, now)
  if (type === 'monthly') return startOfCalendarMonth(shiftCalendarDate(startOfCalendarMonth(localDate), -1))

  const localDay = new Date(`${localDate}T00:00:00.000Z`).getUTCDay()
  const daysSinceMonday = (localDay + 6) % 7
  return shiftCalendarDate(localDate, -(daysSinceMonday + 1))
}

export function buildReportExportName(report: ExportableReport): string {
  return `workpulse-${report.type}-${report.display_start}-to-${report.display_end_inclusive}`
}

export function getReportGenerationError(error: unknown): ReportGenerationError {
  const message = error instanceof Error ? error.message.toLowerCase() : ''
  if (message.includes('api key') || message.includes('api_key')) return 'no_key'
  if (message.includes('timeout') || message.includes('timed out')) return 'timeout'
  if (message.includes('response is invalid') || message.includes('response content is empty')) return 'invalid_response'
  return 'unknown'
}

export function toggleReportScope(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id]
}

export function getHistoryReportState(report: Pick<HistoricalReport, 'status' | 'error_message' | 'retry_count'>): {
  status: HistoricalReport['status']
  errorMessage: string | null
  retryCount: number
} {
  return {
    status: report.status,
    errorMessage: report.error_message,
    retryCount: report.retry_count
  }
}

export function getRetryReportRequest(report: Pick<HistoricalReport, 'type' | 'display_start' | 'timezone' | 'project_scope' | 'repository_scope'>): RetryReportRequest {
  if (report.type !== 'weekly' && report.type !== 'monthly') throw new RangeError('Invalid report type')
  return {
    type: report.type,
    anchorDate: report.display_start,
    timeZone: report.timezone,
    projectIds: [...report.project_scope],
    repositoryIds: [...report.repository_scope]
  }
}

export function hasReportPreviewData(preview: {
  work_log_count: number
  task_count: number
  inbox_count: number
  git_commit_count: number
}): boolean {
  return preview.work_log_count + preview.task_count + preview.inbox_count + preview.git_commit_count > 0
}

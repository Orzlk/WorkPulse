import { getReportAnchorDate } from './reportPeriod'

export type WorkflowReportType = 'weekly' | 'monthly'
export type ReportGenerationError = 'no_key' | 'timeout' | 'invalid_response' | 'unknown'

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

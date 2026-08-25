import type { ReportPeriod, ReportType } from '../lib/period'
import type { ReportSourceSnapshot } from './reportTypes'
import {
  DEFAULT_REPORT_TEMPLATE,
  DEFAULT_SYSTEM_PROMPT,
  replaceReportPromptVariables
} from './reportDefaults'

export interface PeriodReportProvider {
  (input: { systemPrompt: string; userPrompt: string; signal: AbortSignal; onChunk?: (chunk: string) => void }): Promise<unknown>
}

export interface PeriodReportOptions {
  provider: PeriodReportProvider
  timeoutMs?: number
  signal?: AbortSignal
  onChunk?: (chunk: string) => void
  systemPrompt?: string
  reportTemplate?: string
  language?: string
  style?: string
}

export async function generatePeriodReportContent(
  snapshot: Pick<ReportSourceSnapshot, 'schema_version' | 'projects'> & Partial<Pick<ReportSourceSnapshot, 'period'>>,
  reportType: ReportType,
  period: ReportPeriod,
  options: PeriodReportOptions
): Promise<string> {
  if (reportType !== 'weekly' && reportType !== 'monthly') {
    throw new RangeError(`Invalid report type: ${String(reportType)}`)
  }
  if (!Array.isArray(snapshot.projects)) throw new Error('Invalid report snapshot')
  if (snapshot.projects.length === 0) return '# 工作报告\n\n暂无可汇总的工作记录。'

  const [dateFrom, dateTo] = period.label.split(' 至 ')
  const promptVariables = {
    language: options.language ?? '中文',
    style: options.style ?? '简洁专业',
    dateFrom: dateFrom || period.startDate,
    dateTo: dateTo || period.endDateExclusive
  }
  const systemPrompt = replaceReportPromptVariables(options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT, promptVariables)
  const reportTemplate = replaceReportPromptVariables(options.reportTemplate ?? DEFAULT_REPORT_TEMPLATE, promptVariables)
  const userPrompt = JSON.stringify({ reportType, period, reportTemplate, snapshot })
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, options.timeoutMs ?? 60_000)
  const abortExternal = (): void => controller.abort()
  if (options.signal?.aborted) controller.abort()
  else options.signal?.addEventListener('abort', abortExternal, { once: true })
  try {
    const result = await options.provider({ systemPrompt, userPrompt, signal: controller.signal, onChunk: options.onChunk })
    const content = typeof result === 'string'
      ? result
      : typeof result === 'object' && result !== null && 'content' in result && typeof result.content === 'string'
        ? result.content
        : ''
    if (!content.trim()) throw new Error('AI response content is empty')
    return content.trim()
  } catch (error) {
    if (timedOut) throw new Error('AI request timed out')
    if (options.signal?.aborted) throw new Error('AI request cancelled')
    throw error instanceof Error ? error : new Error('AI report generation failed')
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', abortExternal)
  }
}

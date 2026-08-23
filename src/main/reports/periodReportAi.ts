import type { ReportPeriod, ReportType } from '../lib/period'
import type { ReportSourceSnapshot } from './reportTypes'

export interface PeriodReportProvider {
  (input: { systemPrompt: string; userPrompt: string; signal: AbortSignal }): Promise<unknown>
}

export interface PeriodReportOptions {
  provider: PeriodReportProvider
  timeoutMs?: number
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

  const followUp = reportType === 'weekly' ? '下周待跟进' : '下月建议'
  const systemPrompt = `你是专业的工作报告助手。根据用户授权的 JSON 快照生成 Markdown 报告。\n\n要求：\n- 严格按项目分组，提炼核心功能、缺陷、重构/维护。\n- 标记快照中有证据支持的阻塞与${followUp}。\n- 无证据不推断；不要逐条复制 Git commit。\n- 周期：${period.label}。`
  const userPrompt = JSON.stringify({ reportType, period, snapshot })
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 60_000)
  try {
    const result = await options.provider({ systemPrompt, userPrompt, signal: controller.signal })
    const content = typeof result === 'string'
      ? result
      : typeof result === 'object' && result !== null && 'content' in result && typeof result.content === 'string'
        ? result.content
        : ''
    if (!content.trim()) throw new Error('AI response content is empty')
    return content.trim()
  } catch (error) {
    if (controller.signal.aborted) throw new Error('AI request timed out')
    throw error instanceof Error ? error : new Error('AI report generation failed')
  } finally {
    clearTimeout(timer)
  }
}

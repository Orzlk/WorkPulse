import { getSetting } from './db'
import { getStoredApiKey } from './secureSettings'
import { getResolvedLanguage, tMain } from './i18n'
import type { ReportPeriod, ReportType } from './lib/period'
import type { ReportSourceSnapshot } from './reports/reportTypes'
import {
  generatePeriodReportContent as generatePurePeriodReportContent,
  type PeriodReportOptions,
  type PeriodReportProvider
} from './reports/periodReportAi'
import { callAnthropic, callDeepSeek, callOpenAI } from './reports/aiProvider'
import { buildInboxSuggestionPrompt, parseInboxSuggestion, type InboxAiReferences } from './inbox/inboxAi'
import type { InboxSuggestion } from './domain/types'
import {
  DEFAULT_REPORT_TEMPLATE,
  DEFAULT_REPORT_TEMPLATE_EN,
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_SYSTEM_PROMPT_EN,
  replaceReportPromptVariables
} from './reports/reportDefaults'

export type { PeriodReportOptions, PeriodReportProvider } from './reports/periodReportAi'

interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface ReportTaskContext {
  title: string
  description?: string
  status: 'todo' | 'in_progress' | 'done' | 'draft'
  due_date?: string | null
  completed_at?: string | null
}

export async function generateReport(
  logs: { content: string; created_at: string }[],
  dateFrom: string,
  dateTo: string,
  tasks: ReportTaskContext[] = []
): Promise<string> {
  const apiKey = getStoredApiKey()
  if (!apiKey) {
    throw new Error(tMain('apiKeyMissing'))
  }

  const resolvedLanguage = getResolvedLanguage()
  const provider = getSetting('ai_provider') || 'openai'
  const baseUrl = getSetting('ai_base_url') || ''
  const model = getSetting('ai_model') || ''
  const language = getSetting('report_language') || (resolvedLanguage === 'zh' ? '中文' : 'English')
  const style = getSetting('report_style') || (resolvedLanguage === 'zh' ? '简洁专业' : 'Concise professional')
  const customPrompt = getSetting('system_prompt') || (resolvedLanguage === 'zh' ? DEFAULT_SYSTEM_PROMPT : DEFAULT_SYSTEM_PROMPT_EN)
  const reportTemplate = getSetting('report_template') || (resolvedLanguage === 'zh' ? DEFAULT_REPORT_TEMPLATE : DEFAULT_REPORT_TEMPLATE_EN)

  const vars: Record<string, string> = { language, style, dateFrom, dateTo }
  const systemPrompt = replaceReportPromptVariables(customPrompt, vars)
  const templateHint = replaceReportPromptVariables(reportTemplate, vars)

  const logsText = logs
    .map((log) => `[${log.created_at}] ${log.content}`)
    .join('\n')

  const taskContext = formatTaskContext(tasks)
  const taskBlock = taskContext ? tMain('taskContextTitle', { tasks: taskContext }) : ''
  const userMessage = tMain('reportUserMessage', {
    logs: logsText,
    tasks: taskBlock,
    template: templateHint
  })

  const messages: Message[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage }
  ]

  if (provider === 'anthropic') {
    return callAnthropic({ apiKey, baseUrl, model, messages })
  }
  if (provider === 'deepseek') {
    return callDeepSeek({ apiKey, baseUrl, model, messages })
  }
  return callOpenAI({ apiKey, baseUrl, model, messages })
}

export async function generatePeriodReportContent(
  snapshot: Pick<ReportSourceSnapshot, 'schema_version' | 'projects'> & Partial<Pick<ReportSourceSnapshot, 'period'>>,
  reportType: ReportType,
  period: ReportPeriod,
  options: Partial<PeriodReportOptions> = {}
): Promise<string> {
  const resolvedLanguage = getResolvedLanguage()
  const useConfiguredSettings = !options.provider
  const configuredSetting = (key: string, fallback: string): string => useConfiguredSettings ? (getSetting(key) || fallback) : fallback
  const language = options.language ?? configuredSetting('report_language', resolvedLanguage === 'zh' ? '中文' : 'English')
  const style = options.style ?? configuredSetting('report_style', resolvedLanguage === 'zh' ? '简洁专业' : 'Concise professional')
  const systemPrompt = options.systemPrompt ?? configuredSetting('system_prompt', resolvedLanguage === 'zh' ? DEFAULT_SYSTEM_PROMPT : DEFAULT_SYSTEM_PROMPT_EN)
  const reportTemplate = options.reportTemplate ?? configuredSetting('report_template', resolvedLanguage === 'zh' ? DEFAULT_REPORT_TEMPLATE : DEFAULT_REPORT_TEMPLATE_EN)
  const provider: PeriodReportProvider = options.provider ?? ((input) =>
    callConfiguredPeriodProvider(input.systemPrompt, input.userPrompt, input.signal, input.onChunk)
  )
  return generatePurePeriodReportContent(snapshot, reportType, period, {
    provider,
    timeoutMs: options.timeoutMs,
    signal: options.signal,
    onChunk: options.onChunk,
    systemPrompt,
    reportTemplate,
    language,
    style
  })
}

async function callConfiguredPeriodProvider(systemPrompt: string, userPrompt: string, signal: AbortSignal, onChunk?: (chunk: string) => void): Promise<string> {
  const apiKey = getStoredApiKey()
  if (!apiKey) throw new Error(tMain('apiKeyMissing'))
  const provider = getSetting('ai_provider') || 'openai'
  const baseUrl = getSetting('ai_base_url') || ''
  const model = getSetting('ai_model') || ''
  const messages: Message[] = [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }]
  if (provider === 'anthropic') return callAnthropic({ apiKey, baseUrl, model, messages, signal, onChunk })
  if (provider === 'deepseek') return callDeepSeek({ apiKey, baseUrl, model, messages, signal, onChunk })
  return callOpenAI({ apiKey, baseUrl, model, messages, signal, onChunk })
}

export async function generateInboxSuggestion(content: string, references: InboxAiReferences, signal?: AbortSignal): Promise<InboxSuggestion> {
  const apiKey = getStoredApiKey()
  if (!apiKey) throw new Error(tMain('apiKeyMissing'))
  const provider = getSetting('ai_provider') || 'openai'
  const baseUrl = getSetting('ai_base_url') || ''
  const model = getSetting('ai_model') || ''
  const messages: Message[] = [
    {
      role: 'system',
      content: '你是 WorkPulse 收件箱整理助手。只输出合法 JSON，不要 Markdown 代码围栏。只能使用给定的项目、仓库和标签。不要自动执行整理。'
    },
    { role: 'user', content: buildInboxSuggestionPrompt(content, references) }
  ]
  const request = { apiKey, baseUrl, model, messages, signal }
  const raw = provider === 'anthropic'
    ? await callAnthropic(request)
    : provider === 'deepseek'
      ? await callDeepSeek(request)
      : await callOpenAI(request)
  return parseInboxSuggestion(raw, {
    projectIds: references.projects.map((project) => project.public_id),
    repositoryIds: references.repositories.map((repository) => repository.public_id)
  })
}

function formatTaskContext(tasks: ReportTaskContext[]): string {
  if (tasks.length === 0) return ''
  const separator = getResolvedLanguage() === 'zh' ? '，' : ', '

  const statusLabel: Record<ReportTaskContext['status'], string> = {
    todo: tMain('taskTodo'),
    in_progress: tMain('taskInProgress'),
    done: tMain('taskDone'),
    draft: tMain('taskDraft')
  }

  return tasks
    .slice(0, 100)
    .map((task) => {
      const meta = [
        statusLabel[task.status],
        task.due_date ? tMain('taskDue', { date: task.due_date }) : '',
        task.completed_at ? tMain('taskCompletedAt', { date: task.completed_at }) : ''
      ].filter(Boolean).join(separator)
      const description = task.description?.trim() ? ` — ${task.description.trim()}` : ''
      return `- [${meta}] ${task.title}${description}`
    })
    .join('\n')
}

export { DEFAULT_SYSTEM_PROMPT, DEFAULT_REPORT_TEMPLATE, DEFAULT_SYSTEM_PROMPT_EN, DEFAULT_REPORT_TEMPLATE_EN }

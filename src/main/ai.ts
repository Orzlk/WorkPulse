import { getSetting } from './db'
import { getStoredAiCustomHeaders, getStoredApiKey } from './secureSettings'
import { getResolvedLanguage, tMain } from './i18n'
import {
  createAiProviderConfig,
  configRequiresApiKey,
  getAiProviderPreset,
  validateAiProviderConfig,
  type AiAuthMode,
  type AiProtocol,
  type AiProviderConfig
} from '../shared/aiProviderConfig'
import type { ReportPeriod, ReportType } from './lib/period'
import type { ReportSourceSnapshot } from './reports/reportTypes'
import {
  generatePeriodReportContent as generatePurePeriodReportContent,
  type PeriodReportOptions,
  type PeriodReportProvider
} from './reports/periodReportAi'
import { callAiProvider, type ProviderRequest } from './reports/aiProvider'
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

function configuredAiProviderConfig(): AiProviderConfig {
  const configuredId = getSetting('ai_provider') || 'openai'
  const preset = getAiProviderPreset(configuredId) ?? getAiProviderPreset('openai')!
  const presetConfig = createAiProviderConfig(preset.id)
  const protocol = getSetting('ai_protocol')
  const authMode = getSetting('ai_auth_mode')
  return {
    ...presetConfig,
    presetId: preset.id,
    displayName: configuredId,
    protocol: protocol === 'openai-chat' || protocol === 'openai-responses' || protocol === 'anthropic-messages'
      ? protocol as AiProtocol
      : preset.protocol,
    authMode: authMode === 'bearer' || authMode === 'x-api-key' || authMode === 'none'
      ? authMode as AiAuthMode
      : preset.authMode,
    baseUrl: getSetting('ai_base_url') || preset.baseUrl,
    model: getSetting('ai_model') || preset.model,
    customHeaders: getStoredAiCustomHeaders()
  }
}

function configuredAiRequest(messages: Message[], signal?: AbortSignal, onChunk?: (chunk: string) => void): ProviderRequest {
  const config = configuredAiProviderConfig()
  const apiKey = getStoredApiKey()
  if (configRequiresApiKey(config) && !apiKey?.trim()) throw new Error(tMain('apiKeyMissing'))
  const validationError = validateAiProviderConfig(config, apiKey)
  if (validationError) throw new Error(validationError)
  return {
    apiKey,
    baseUrl: config.baseUrl,
    model: config.model,
    config,
    messages,
    signal,
    onChunk
  }
}

export async function generateReport(
  logs: { content: string; created_at: string }[],
  dateFrom: string,
  dateTo: string,
  tasks: ReportTaskContext[] = []
): Promise<string> {
  const resolvedLanguage = getResolvedLanguage()
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

  return callAiProvider(configuredAiRequest(messages))
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
  const messages: Message[] = [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }]
  return callAiProvider(configuredAiRequest(messages, signal, onChunk))
}

export async function generateInboxSuggestion(content: string, references: InboxAiReferences, signal?: AbortSignal): Promise<InboxSuggestion> {
  const messages: Message[] = [
    {
      role: 'system',
      content: '你是 WorkPulse 收件箱整理助手。只输出合法 JSON，不要 Markdown 代码围栏。只能使用给定的项目和标签。不要自动执行整理。'
    },
    { role: 'user', content: buildInboxSuggestionPrompt(content, references) }
  ]
  const raw = await callAiProvider(configuredAiRequest(messages, signal))
  return parseInboxSuggestion(raw, {
    projectIds: references.projects.map((project) => project.public_id)
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

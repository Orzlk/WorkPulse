import { useEffect, useRef, useState } from 'react'
import {
  Eye,
  EyeOff,
  Trash2,
  RotateCcw,
  Keyboard,
  Sun,
  Moon,
  Monitor,
  RefreshCw,
  Download,
  CheckCircle2,
  AlertCircle,
  FolderOpen,
  AlertTriangle,
  ExternalLink,
  ShieldCheck,
  Sparkles
} from 'lucide-react'
import { useToast } from '../components/Toast'
import { useThemeStore } from '../stores/themeStore'
import { useI18n, useLanguageStore } from '../stores/languageStore'
import type { AppLanguage, ResolvedLanguage } from '../lib/i18n'
import { isClearDataConfirmationValid } from '../lib/clearDataConfirmation'
import { WorkspacePageHeader } from '../components/WorkspacePageHeader'
import { DatabaseTransferCard } from '../components/DatabaseTransferCard'
import { WorkLogTransferCard } from '../components/WorkLogTransferCard'
import workpulseLogo from '../assets/workpulse-logo.png'

// Convert a KeyboardEvent to an Electron-style accelerator string
function eventToAccelerator(e: KeyboardEvent): string | null {
  // Ignore modifier-only keydowns
  if (['Meta', 'Control', 'Alt', 'Shift'].includes(e.key)) return null
  const parts: string[] = []
  if (e.metaKey || e.ctrlKey) parts.push('CmdOrCtrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  // Map special keys
  const keyMap: Record<string, string> = {
    ' ': 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
    Backspace: 'Backspace', Delete: 'Delete', Escape: 'Escape', Enter: 'Return',
    Tab: 'Tab', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown'
  }
  const key = keyMap[e.key] ?? (e.key.length === 1 ? e.key.toUpperCase() : e.key)
  parts.push(key)
  // Need at least a modifier + key for a global shortcut
  if (parts.length < 2) return null
  return parts.join('+')
}

function ShortcutCapture({
  value,
  onChange,
  capturingLabel
}: {
  value: string
  onChange: (v: string) => void
  capturingLabel: string
}): JSX.Element {
  const [capturing, setCapturing] = useState(false)
  const ref = useRef<HTMLButtonElement>(null)

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    if (e.key === 'Escape') { setCapturing(false); return }
    const acc = eventToAccelerator(e.nativeEvent)
    if (acc) {
      onChange(acc)
      setCapturing(false)
    }
  }

  return (
    <button
      ref={ref}
      onFocus={() => setCapturing(true)}
      onBlur={() => setCapturing(false)}
      onKeyDown={capturing ? handleKeyDown : undefined}
      className={`flex items-center gap-2 px-3 py-2 border rounded-lg text-sm font-mono transition-all outline-none
        ${capturing
          ? 'border-zinc-500 ring-2 ring-zinc-200 dark:ring-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400'
          : 'border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:border-zinc-400 cursor-pointer'
        }`}
    >
      <Keyboard className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
      {capturing ? capturingLabel : value}
    </button>
  )
}

interface Props {
  onBack: () => void
}

type UpdateStatus = 'idle' | 'checking' | 'available' | 'not_available' | 'downloading' | 'downloaded' | 'error'
type AiProvider = 'openai' | 'anthropic' | 'deepseek'
type AiTestState =
  | { status: 'idle' | 'testing' }
  | { status: 'success'; latencyMs: number; model: string }
  | { status: 'error'; message: string }

interface AppUpdateState {
  status: UpdateStatus
  currentVersion: string
  version?: string
  releaseUrl?: string
  downloadUrl?: string
  progress?: number
  error?: string
  canInstall?: boolean
}

type SettingsSectionId = 'ai' | 'data' | 'shortcuts' | 'appearance' | 'updates'

const DEFAULT_SYSTEM_PROMPT = `你是一名专业的工作总结与项目汇报助手，负责将工作日志、任务记录、项目资料和 Git 改动记录整理为适合团队汇报的工作总结。

## 报告参数

- 报告语言：{{language}}
- 报告风格：{{style}}
- 统计时间：{{dateFrom}} 至 {{dateTo}}
- 输出格式：Markdown

## 核心目标

请对输入内容进行归类、合并和提炼，输出专业、简洁、清晰、成果导向的工作汇报。

重点提炼：

1. 核心功能、产品或模块改动
2. 已完成的工作和交付成果
3. 解决的缺陷、问题和技术难点
4. 性能、效率、稳定性或质量改进
5. 当前正在推进的事项
6. 后续需要继续跟进的工作
7. 需要协作、决策或外部支持的阻塞事项

## 信息归纳规则

### 按项目和主题归类

优先按照“项目 → 模块或主题 → 工作成果”进行整理。

同一项目在不同日期的日志、任务和 Git 记录应合并总结，不要重复描述。

如果没有明确项目归属，可以根据内容归纳为中性的主题名称，例如“设备通信优化”“系统稳定性改进”，不得虚构正式项目名称。

### 成果导向

不要简单描述“做了什么”，应尽量体现：

工作内容 → 解决的问题 → 产生的结果或价值

优先保留日志中明确出现的功能、版本、数量、指标、测试结果、性能变化和交付物。

### Git 记录处理

Git 提交只用于辅助理解实际改动：

- 提炼功能、修复、重构和维护内容
- 合并同一项目的相关提交
- 不逐条罗列 commit
- 不输出 commit hash，除非对汇报确有必要
- 不把提交次数直接等同于工作成果

### 状态判断

只有日志或任务明确表达完成，才能标记为“已完成”。

- 已完成：明确完成、交付、上线、验证通过
- 阶段性完成：完成主要部分，但仍有后续工作
- 持续推进：开发中、测试中、调研中、优化中
- 待跟进：明确记录了后续动作，但尚未完成

不得将“计划、尝试、调研、测试中、推进中”描述为已完成。

### 真实性要求

只能依据输入内容进行总结：

- 不得虚构数据、项目、成果、完成状态或业务价值
- 没有量化数据时使用定性描述
- 没有明确后续计划时，不得自行推测
- 不确定的信息使用谨慎表达

## 写作要求

整体风格应符合 {{style}}：

- 专业、客观、简洁
- 优先使用短句和项目符号
- 突出结果和影响
- 避免流水账、重复描述和空洞套话
- 不要大段复述原始日志
- 不要过度包装或夸大成果
- 没有内容的章节直接省略
- 不输出分析过程、提示词说明或免责声明

生成报告前，请检查是否遗漏重要项目、重复描述、错误判断状态或虚构事实。

最后只输出完整的 Markdown 工作汇报。`

const DEFAULT_REPORT_TEMPLATE = `# 工作汇报｜{{dateFrom}} 至 {{dateTo}}

## 一、总体进展

用 2～4 条简要概括本周期的整体进展、重点成果和主要问题。

## 二、项目进展

### 项目或主题名称

- **核心成果：** 概括本周期完成的主要工作和交付结果。
- **功能与改进：** 说明新增功能、优化、重构、测试或维护内容。
- **缺陷与风险：** 说明已解决的问题、当前缺陷、风险或阻塞。
- **当前状态：** 已完成、阶段性完成、持续推进或待跟进。

> 根据实际内容选择字段。没有内容的字段直接省略，不要生成“暂无”或空泛描述。

## 三、关键成果

提炼本周期最值得关注的 3～5 项成果。

- **成果名称：** 简要说明成果及其实际价值。

## 四、进行中与下一步

总结明确记录的未完成事项、后续工作和需要继续推进的重点。

- **事项：** 当前进展及下一步动作。

> 如果没有明确的进行中事项或后续计划，直接省略本章节。`

const DEFAULT_SYSTEM_PROMPT_EN = `You are a professional work summary and project reporting assistant. Turn work logs, task records, project materials, and Git change records into a team-ready work report.

## Report Parameters

- Report language: {{language}}
- Report style: {{style}}
- Reporting period: {{dateFrom}} to {{dateTo}}
- Output format: Markdown

## Core Objective

Categorize, merge, and distill the input into a professional, concise, clear, outcome-oriented work report.

Focus on:

1. Core feature, product, or module changes
2. Completed work and delivered outcomes
3. Resolved defects, problems, and technical challenges
4. Performance, efficiency, stability, or quality improvements
5. Work currently in progress
6. Explicit follow-up work
7. Blockers requiring collaboration, decisions, or external support

## Information Synthesis Rules

### Group by project and topic

Prefer the structure “project → module or topic → outcome”. Merge logs, tasks, and Git records from different dates when they belong to the same project. Do not repeat the same work.

If no project is specified, infer a neutral topic from the evidence, but do not invent an official project name.

### Focus on outcomes

Explain the relationship between work performed, the problem addressed, and the resulting outcome or value. Preserve explicit features, versions, quantities, metrics, test results, performance changes, and deliverables.

### Git records

Use Git commits only to understand actual changes:

- Distill features, fixes, refactors, and maintenance
- Merge related commits within the same project
- Do not list commits one by one
- Do not include commit hashes unless necessary for the report
- Do not equate commit count with work outcomes

### Determine status

Mark work as completed only when the input explicitly indicates completion.

- Completed: explicitly completed, delivered, released, or verified
- Partially completed: major work is done but follow-up remains
- In progress: being developed, tested, researched, or optimized
- Follow-up: an explicit next action that is not complete

Do not describe plans, attempts, research, testing, or ongoing work as completed.

### Truthfulness

Use only the supplied evidence:

- Do not invent data, projects, outcomes, status, or business value
- Use qualitative wording when no metrics are provided
- Do not infer next steps when none are explicitly recorded
- Use cautious wording for uncertain information

## Writing Requirements

The writing style must follow {{style}}:

- Professional, objective, and concise
- Prefer short sentences and bullet points
- Emphasize outcomes and impact
- Avoid a chronological dump, repetition, and empty phrases
- Do not reproduce the raw logs at length
- Do not exaggerate the results
- Omit sections with no supporting content
- Do not output analysis, prompt instructions, or disclaimers

Before finalizing, check for omitted projects, repetition, incorrect status judgments, and invented facts.

Output only the complete Markdown work report.`

const DEFAULT_REPORT_TEMPLATE_EN = `# Work Report | {{dateFrom}} to {{dateTo}}

## 1. Overall Progress

Summarize the overall progress, key outcomes, and major issues of this period in 2–4 concise bullet points.

## 2. Project Progress

### Project or Topic Name

- **Key Outcomes:** Summarize the main work completed and delivered results.
- **Features and Improvements:** Describe new features, optimization, refactoring, testing, or maintenance.
- **Defects and Risks:** Describe resolved problems, current defects, risks, or blockers.
- **Current Status:** Completed, partially completed, in progress, or follow-up.

> Select fields based on the evidence. Omit empty fields instead of creating placeholders such as “None”.

## 3. Key Outcomes

Highlight the 3–5 most important outcomes of this period.

- **Outcome:** Briefly explain the outcome and its practical value.

## 4. In Progress and Next Steps

Summarize explicit unfinished work, follow-up actions, and priorities for the next period.

- **Item:** Current progress and next action.

> Omit this section when no explicit unfinished work or next steps are available.`

function getDefaultSystemPrompt(language: ResolvedLanguage): string {
  return language === 'zh' ? DEFAULT_SYSTEM_PROMPT : DEFAULT_SYSTEM_PROMPT_EN
}

function getDefaultReportTemplate(language: ResolvedLanguage): string {
  return language === 'zh' ? DEFAULT_REPORT_TEMPLATE : DEFAULT_REPORT_TEMPLATE_EN
}

function SettingsPage({ onBack }: Props): JSX.Element {
  const isMac = navigator.userAgent.includes('Mac')
  const modifierLabel = isMac ? 'Cmd' : 'Ctrl'
  const { language: appLanguage, resolvedLanguage, t } = useI18n()
  const setAppLanguage = useLanguageStore((s) => s.setLanguage)
  const previousLanguageRef = useRef<ResolvedLanguage>(resolvedLanguage)
  const [apiKey, setApiKey] = useState('')
  const [hasKey, setHasKey] = useState(false)
  const [showKey, setShowKey] = useState(false)
  const [editing, setEditing] = useState(false)
  const [provider, setProvider] = useState<AiProvider>('openai')
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [aiTestState, setAiTestState] = useState<AiTestState>({ status: 'idle' })
  const [reportLanguage, setReportLanguage] = useState(resolvedLanguage === 'zh' ? '中文' : 'English')
  const [style, setStyle] = useState(t('settings.styleConcise'))
  const [systemPrompt, setSystemPrompt] = useState(getDefaultSystemPrompt(resolvedLanguage))
  const [reportTemplate, setReportTemplate] = useState(getDefaultReportTemplate(resolvedLanguage))
  const [reportRemindersEnabled, setReportRemindersEnabled] = useState(true)
  const [savingReportReminder, setSavingReportReminder] = useState(false)
  const [reportReminderPeriod, setReportReminderPeriod] = useState<'weekly' | 'monthly'>('weekly')
  const [shortcutLog, setShortcutLog] = useState('CmdOrCtrl+Shift+L')
  const [shortcutTask, setShortcutTask] = useState('CmdOrCtrl+Shift+T')
  const [appVersion, setAppVersion] = useState('')
  const [updateState, setUpdateState] = useState<AppUpdateState>({
    status: 'idle',
    currentVersion: ''
  })
  const [clearDataOpen, setClearDataOpen] = useState(false)
  const [clearDataInput, setClearDataInput] = useState('')
  const [clearingData, setClearingData] = useState(false)
  const [activeSection, setActiveSection] = useState<SettingsSectionId>('ai')
  const toast = useToast()
  const { theme, setTheme } = useThemeStore()
  const styleOptions = [
    t('settings.styleConcise'),
    t('settings.styleDetailed'),
    t('settings.styleCasual')
  ]

  useEffect(() => {
    loadSettings()

    void window.api.app.getVersion().then(setAppVersion)
    void window.api.app.getUpdateState().then(setUpdateState)
    const unsubscribeUpdateStatus = window.api.on.updateStatus(setUpdateState)

    return () => {
      unsubscribeUpdateStatus()
    }
  }, [])

  useEffect(() => {
    const previousLanguage = previousLanguageRef.current
    if (previousLanguage === resolvedLanguage) return

    setReportLanguage((current) => {
      const previousDefault = previousLanguage === 'zh' ? '中文' : 'English'
      return current === previousDefault ? (resolvedLanguage === 'zh' ? '中文' : 'English') : current
    })
    setStyle((current) => {
      const previousDefault = previousLanguage === 'zh' ? '简洁专业' : 'Concise professional'
      return current === previousDefault ? t('settings.styleConcise') : current
    })
    setSystemPrompt((current) => {
      const previousDefault = getDefaultSystemPrompt(previousLanguage)
      return current.trim() === previousDefault.trim() ? getDefaultSystemPrompt(resolvedLanguage) : current
    })
    setReportTemplate((current) => {
      const previousDefault = getDefaultReportTemplate(previousLanguage)
      return current.trim() === previousDefault.trim() ? getDefaultReportTemplate(resolvedLanguage) : current
    })

    previousLanguageRef.current = resolvedLanguage
  }, [resolvedLanguage, t])

  const loadSettings = async (): Promise<void> => {
    const key = await window.api.settings.get('api_key')
    if (key) {
      setApiKey(key)
      setHasKey(true)
    }
    const p = await window.api.settings.get('ai_provider')
    if (p === 'openai' || p === 'anthropic' || p === 'deepseek') setProvider(p)
    const b = await window.api.settings.get('ai_base_url')
    if (b) setBaseUrl(b)
    const m = await window.api.settings.get('ai_model')
    if (m) setModel(m)
    const l = await window.api.settings.get('report_language')
    if (l) {
      setReportLanguage(l)
    } else {
      setReportLanguage(resolvedLanguage === 'zh' ? '中文' : 'English')
    }
    const s = await window.api.settings.get('report_style')
    if (s) {
      setStyle(s)
    } else {
      setStyle(t('settings.styleConcise'))
    }
    const sp = await window.api.settings.get('system_prompt')
    if (sp) setSystemPrompt(sp)
    const rt = await window.api.settings.get('report_template')
    if (rt) setReportTemplate(rt)
    const reminders = await window.api.settings.get('report_reminders_enabled')
    setReportRemindersEnabled(reminders !== 'false')
    const reminderPeriod = await window.api.settings.get('report_reminder_period')
    if (reminderPeriod === 'weekly' || reminderPeriod === 'monthly') setReportReminderPeriod(reminderPeriod)
    const sl = await window.api.settings.get('shortcut_quick_log')
    if (sl) setShortcutLog(sl)
    const st = await window.api.settings.get('shortcut_quick_task')
    if (st) setShortcutTask(st)
  }

  const handleShortcutChange = async (
    key: 'shortcut_quick_log' | 'shortcut_quick_task',
    value: string,
    setter: (v: string) => void
  ): Promise<void> => {
    const updated = await window.api.shortcut.update(key, value)
    if (!updated) {
      toast.error(t('settings.shortcutTaken'))
      return
    }

    setter(value)
    toast.success(t('settings.shortcutSaved'))
  }

  const maskKey = (key: string): string => {
    if (key.length <= 8) return '****'
    return key.slice(0, 4) + '****' + key.slice(-4)
  }

  const handleSaveKey = async (): Promise<void> => {
    if (!apiKey.trim()) return
    await window.api.settings.set('api_key', apiKey.trim())
    setHasKey(true)
    setEditing(false)
    toast.success(t('settings.apiKeySaved'))
  }

  const handleDeleteKey = async (): Promise<void> => {
    await window.api.settings.delete('api_key')
    setApiKey('')
    setHasKey(false)
    setEditing(false)
    toast.success(t('settings.apiKeyDeleted'))
  }

  const saveSetting = async (key: string, value: string): Promise<void> => {
    if (value.trim()) {
      await window.api.settings.set(key, value.trim())
    } else {
      await window.api.settings.delete(key)
    }
  }

  const handleProviderChange = async (value: AiProvider): Promise<void> => {
    setProvider(value)
    await window.api.settings.set('ai_provider', value)
  }

  const handleAiConnectionTest = async (): Promise<void> => {
    if (!apiKey.trim() || aiTestState.status === 'testing') return
    setAiTestState({ status: 'testing' })
    try {
      const result = await window.api.ai.testConnection({
        provider,
        api_key: apiKey.trim(),
        base_url: baseUrl.trim() || undefined,
        model: model.trim() || undefined
      })
      if (result.ok) {
        setAiTestState({ status: 'success', latencyMs: result.latency_ms, model: result.model })
      } else {
        setAiTestState({ status: 'error', message: result.error || t('settings.aiTestUnknownError') })
      }
    } catch {
      setAiTestState({ status: 'error', message: t('settings.aiTestUnknownError') })
    }
  }

  const handleBaseUrlBlur = async (): Promise<void> => {
    await saveSetting('ai_base_url', baseUrl)
  }

  const handleModelBlur = async (): Promise<void> => {
    await saveSetting('ai_model', model)
  }

  const handleLanguageChange = async (value: string): Promise<void> => {
    setReportLanguage(value)
    await window.api.settings.set('report_language', value)
  }

  const handleStyleChange = async (value: string): Promise<void> => {
    setStyle(value)
    await window.api.settings.set('report_style', value)
  }

  const handleAppLanguageChange = async (value: AppLanguage): Promise<void> => {
    await setAppLanguage(value)
  }

  const handleSystemPromptBlur = async (): Promise<void> => {
    if (systemPrompt.trim() === getDefaultSystemPrompt(resolvedLanguage).trim()) {
      await window.api.settings.delete('system_prompt')
    } else {
      await window.api.settings.set('system_prompt', systemPrompt)
    }
  }

  const handleReportTemplateBlur = async (): Promise<void> => {
    if (reportTemplate.trim() === getDefaultReportTemplate(resolvedLanguage).trim()) {
      await window.api.settings.delete('report_template')
    } else {
      await window.api.settings.set('report_template', reportTemplate)
    }
  }

  const handleReminderToggle = async (enabled: boolean): Promise<void> => {
    const previous = reportRemindersEnabled
    setReportRemindersEnabled(enabled)
    setSavingReportReminder(true)
    try {
      await window.api.settings.set('report_reminders_enabled', String(enabled))
    } catch {
      setReportRemindersEnabled(previous)
      toast.error(t('settings.reportReminderSaveFailed'))
    } finally {
      setSavingReportReminder(false)
    }
  }

  const handleReminderPeriodChange = async (period: 'weekly' | 'monthly'): Promise<void> => {
    setReportReminderPeriod(period)
    await window.api.settings.set('report_reminder_period', period)
  }

  const resetSystemPrompt = async (): Promise<void> => {
    setSystemPrompt(getDefaultSystemPrompt(resolvedLanguage))
    await window.api.settings.delete('system_prompt')
    toast.success(t('settings.systemPromptReset'))
  }

  const resetReportTemplate = async (): Promise<void> => {
    setReportTemplate(getDefaultReportTemplate(resolvedLanguage))
    await window.api.settings.delete('report_template')
    toast.success(t('settings.templateReset'))
  }

  const handleCheckUpdates = async (): Promise<void> => {
    const state = await window.api.app.checkForUpdates()
    setUpdateState(state)

    if (state.status === 'not_available') {
      toast.success(t('settings.updateNotAvailable'))
    } else if (state.status === 'error') {
      toast.error(t('settings.updateError', { message: state.error || '' }))
    }
  }

  const handleInstallUpdate = async (): Promise<void> => {
    await window.api.app.installUpdate()
  }

  const clearDataLanguage: 'zh' | 'en' = resolvedLanguage === 'zh' ? 'zh' : 'en'
  const canConfirmClearData = isClearDataConfirmationValid(clearDataInput, clearDataLanguage)

  const handleClearData = async (): Promise<void> => {
    if (!canConfirmClearData || clearingData) return
    setClearingData(true)
    try {
      const result = await window.api.database.clear()
      setClearDataOpen(false)
      setClearDataInput('')
      toast.success(t('settings.clearDataSuccess', {
        logs: result.deleted.work_logs ?? 0,
        tasks: result.deleted.tasks ?? 0,
        path: result.backupPath
      }))
      window.setTimeout(() => window.location.reload(), 700)
    } catch {
      toast.error(t('settings.clearDataFailed'))
    } finally {
      setClearingData(false)
    }
  }

  const getUpdateMessage = (): string => {
    switch (updateState.status) {
      case 'checking':
        return t('settings.checkingUpdates')
      case 'available':
        return updateState.downloadUrl
          ? t('settings.updateAvailableManual', { version: updateState.version || '' })
          : t('settings.updateAvailable', { version: updateState.version || '' })
      case 'downloading':
        return t('settings.updateDownloading', { progress: updateState.progress ?? 0 })
      case 'downloaded':
        return t('settings.updateDownloaded')
      case 'not_available':
        return t('settings.updateNotAvailable')
      case 'error':
        return t('settings.updateError', { message: updateState.error || '' })
      case 'idle':
      default:
        return t('settings.updateIdle')
    }
  }

  const currentVersion = appVersion || updateState.currentVersion || '-'
  const onlineUpdatesEnabled = true
  const isCheckingUpdate = updateState.status === 'checking' || updateState.status === 'downloading'
  const settingsSections: Array<{ id: SettingsSectionId; label: string }> = [
    { id: 'ai', label: t('settings.aiAndReports') },
    { id: 'data', label: t('settings.dataManagement') },
    { id: 'shortcuts', label: t('settings.shortcuts') },
    { id: 'appearance', label: t('settings.appearance') },
    { id: 'updates', label: t('settings.updatesAndAbout') }
  ]

  const scrollToSettingsSection = (section: SettingsSectionId): void => {
    setActiveSection(section)
    document.getElementById(`settings-${section}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="hallmark-app h-screen flex flex-col">
      {/* Content */}
      <main className="flex-1 overflow-auto">
        <div className="settings-page-shell">
          <WorkspacePageHeader ariaLabel={t('workspace.breadcrumbLabel')} items={[{ label: t('settings.title'), current: true }]} title={t('settings.title')} onHome={onBack} />
          <div className="settings-layout">
            <aside className="settings-sidebar" aria-label={t('settings.navigation')}>
              <p className="settings-sidebar-title">{t('settings.navigation')}</p>
              <nav className="settings-sidebar-nav">
                {settingsSections.map((section) => (
                  <button
                    key={section.id}
                    type="button"
                    className={`settings-sidebar-button ${activeSection === section.id ? 'is-selected' : ''}`}
                    aria-current={activeSection === section.id ? 'location' : undefined}
                    onClick={() => scrollToSettingsSection(section.id)}
                  >
                    {section.label}
                  </button>
                ))}
              </nav>
            </aside>
            <div className="settings-content">
          {/* AI Configuration */}
          <section id="settings-ai" className="settings-section">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-1">{t('settings.aiConfig')}</h2>
            <div className="h-px bg-zinc-200 dark:bg-zinc-700 mb-4" />

            {/* API Key */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">API Key</label>
              <p className="text-xs text-zinc-400 mb-2">{t('settings.apiKeyHelp')}</p>
              {hasKey && !editing ? (
                <div className="flex items-center gap-2">
                  <code className="flex-1 px-3 py-2 bg-zinc-100 dark:bg-zinc-800 rounded-md text-sm text-zinc-600 dark:text-zinc-400 font-mono">
                    {showKey ? apiKey : maskKey(apiKey)}
                  </code>
                  <button
                    onClick={() => setShowKey(!showKey)}
                    className="p-2 text-zinc-400 hover:text-zinc-600"
                    aria-label={showKey ? t('settings.hide') : t('settings.show')}
                  >
                    {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={() => setEditing(true)}
                    className="px-3 py-1.5 text-sm text-zinc-600 border border-zinc-300 rounded-md hover:bg-zinc-50"
                  >
                    {t('settings.modify')}
                  </button>
                  <button
                    onClick={handleDeleteKey}
                    className="p-2 text-zinc-400 hover:text-red-500"
                    aria-label={t('settings.deleteApiKey')}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={t('settings.apiKeyPlaceholder')}
                    className="flex-1 px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-md text-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 dark:focus:ring-zinc-700 bg-white dark:bg-zinc-800 dark:text-zinc-100"
                  />
                  <button
                    onClick={handleSaveKey}
                    className="px-4 py-2 text-sm bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-md hover:bg-zinc-800 dark:hover:bg-zinc-200"
                  >
                    {t('common.save')}
                  </button>
                  {editing && (
                    <button
                      onClick={() => {
                        setEditing(false)
                        loadSettings()
                      }}
                      className="px-3 py-2 text-sm text-zinc-500 hover:text-zinc-700"
                    >
                      {t('common.cancel')}
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* AI Provider */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">{t('settings.aiProvider')}</label>
              <select
                value={provider}
                onChange={(e) => {
                  const value = e.target.value
                  if (value === 'openai' || value === 'anthropic' || value === 'deepseek') void handleProviderChange(value)
                }}
                className="px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-md text-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 dark:focus:ring-zinc-700 bg-white dark:bg-zinc-800 dark:text-zinc-100"
              >
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic (Claude)</option>
                <option value="deepseek">DeepSeek</option>
              </select>
            </div>

            {/* Base URL */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">{t('settings.baseUrl')}</label>
              <p className="text-xs text-zinc-400 mb-2">
                {t('settings.baseUrlHelp')}
              </p>
              <input
                type="text"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                onBlur={handleBaseUrlBlur}
                placeholder={provider === 'openai' ? 'https://api.openai.com' : provider === 'deepseek' ? 'https://api.deepseek.com' : 'https://api.anthropic.com'}
                className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-md text-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 dark:focus:ring-zinc-700 bg-white dark:bg-zinc-800 dark:text-zinc-100 font-mono"
              />
            </div>
            {/* Model */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">{t('settings.modelName')}</label>
              <p className="text-xs text-zinc-400 mb-2">
                {t('settings.modelHelp')}
              </p>
              <input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                onBlur={handleModelBlur}
                placeholder={provider === 'openai' ? 'gpt-4o-mini' : provider === 'deepseek' ? 'deepseek-chat' : 'claude-sonnet-4-20250514'}
                className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-md text-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 dark:focus:ring-zinc-700 bg-white dark:bg-zinc-800 dark:text-zinc-100 font-mono"
              />
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
              <button
                type="button"
                onClick={() => { void handleAiConnectionTest() }}
                disabled={!apiKey.trim() || aiTestState.status === 'testing'}
                className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-700 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                <RefreshCw className={`h-4 w-4 ${aiTestState.status === 'testing' ? 'animate-spin' : ''}`} aria-hidden="true" />
                {aiTestState.status === 'testing' ? t('settings.aiTestTesting') : t('settings.aiTestConnection')}
              </button>
              {!apiKey.trim() && <span className="text-xs text-zinc-400">{t('settings.aiTestMissingKey')}</span>}
              {aiTestState.status === 'success' && (
                <span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                  {t('settings.aiTestSuccess', { latency: aiTestState.latencyMs, model: aiTestState.model })}
                </span>
              )}
              {aiTestState.status === 'error' && (
                <span className="inline-flex min-w-0 items-center gap-1 text-xs text-red-600 dark:text-red-400">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="break-all">{t('settings.aiTestFailed', { message: aiTestState.message })}</span>
                </span>
              )}
            </div>
          </section>

          {/* Report Preferences */}
          <section className="settings-section">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-1">{t('settings.reportPrefs')}</h2>
            <div className="h-px bg-zinc-200 dark:bg-zinc-700 mb-4" />

            <div className="mb-5 rounded-lg border border-zinc-200 dark:border-zinc-700 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{t('settings.reportReminder')}</h3>
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{t('settings.reportReminderHelp')}</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={reportRemindersEnabled}
                  aria-busy={savingReportReminder}
                  aria-label={t('settings.reportReminder')}
                  disabled={savingReportReminder}
                  onClick={() => { void handleReminderToggle(!reportRemindersEnabled) }}
                  className={`settings-switch ${reportRemindersEnabled ? 'is-on' : ''}`}
                >
                  <span className="settings-switch-thumb" />
                  <span className="sr-only">{t('settings.reportReminder')}</span>
                </button>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <label htmlFor="report-reminder-period" className="text-sm text-zinc-600 dark:text-zinc-300">{t('settings.reportReminderPeriod')}</label>
                <select id="report-reminder-period" value={reportReminderPeriod} disabled={!reportRemindersEnabled} onChange={(event) => { void handleReminderPeriodChange(event.target.value as 'weekly' | 'monthly') }} className="min-h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-zinc-400 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100">
                  <option value="weekly">{t('report.weekly')}</option>
                  <option value="monthly">{t('report.monthly')}</option>
                </select>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">{reportRemindersEnabled ? t('settings.reportReminderEnabled') : t('settings.reportReminderDisabled')}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">{t('settings.reportLanguage')}</label>
                <select
                  value={reportLanguage}
                  onChange={(e) => handleLanguageChange(e.target.value)}
                  className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-md text-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 dark:focus:ring-zinc-700 bg-white dark:bg-zinc-800 dark:text-zinc-100"
                >
                  <option value="中文">中文</option>
                  <option value="English">English</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">{t('settings.reportStyle')}</label>
                <select
                  value={style}
                  onChange={(e) => handleStyleChange(e.target.value)}
                  className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-md text-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 dark:focus:ring-zinc-700 bg-white dark:bg-zinc-800 dark:text-zinc-100"
                >
                  {!styleOptions.includes(style) && <option value={style}>{style}</option>}
                  {styleOptions.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* System Prompt */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('settings.systemPrompt')}</label>
                <button
                  onClick={resetSystemPrompt}
                  className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-600"
                  title={t('settings.restoreDefault')}
                >
                  <RotateCcw className="w-3 h-3" />
                  {t('settings.restoreDefault')}
                </button>
              </div>
              <p className="text-xs text-zinc-400 mb-2">
                {t('settings.promptHelp')}
              </p>
              <textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                onBlur={handleSystemPromptBlur}
                rows={8}
                className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg text-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 dark:focus:ring-zinc-700 bg-white dark:bg-zinc-800 dark:text-zinc-100 font-mono leading-relaxed resize-y"
              />
            </div>

            {/* Report Template */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('settings.reportTemplate')}</label>
                <button
                  onClick={resetReportTemplate}
                  className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-600"
                  title={t('settings.restoreDefault')}
                >
                  <RotateCcw className="w-3 h-3" />
                  {t('settings.restoreDefault')}
                </button>
              </div>
              <p className="text-xs text-zinc-400 mb-2">
                {t('settings.templateHelp')}
              </p>
              <textarea
                value={reportTemplate}
                onChange={(e) => setReportTemplate(e.target.value)}
                onBlur={handleReportTemplateBlur}
                rows={10}
                className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg text-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 dark:focus:ring-zinc-700 bg-white dark:bg-zinc-800 dark:text-zinc-100 font-mono leading-relaxed resize-y"
              />
            </div>
          </section>

          {/* Shortcuts */}
          <section id="settings-shortcuts" className="settings-section">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-1">{t('settings.shortcuts')}</h2>
            <div className="h-px bg-zinc-200 dark:bg-zinc-700 mb-4" />
            <p className="text-xs text-zinc-400 mb-4">
              {t('settings.shortcutsHelp')}
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">{t('settings.shortcutLog')}</label>
                <ShortcutCapture
                  value={shortcutLog}
                  onChange={(v) => handleShortcutChange('shortcut_quick_log', v, setShortcutLog)}
                  capturingLabel={t('settings.capturingShortcut')}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">{t('settings.shortcutTask')}</label>
                <ShortcutCapture
                  value={shortcutTask}
                  onChange={(v) => handleShortcutChange('shortcut_quick_task', v, setShortcutTask)}
                  capturingLabel={t('settings.capturingShortcut')}
                />
              </div>
            </div>

            <div className="mt-4 p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg">
              <p className="text-xs font-medium text-zinc-600 dark:text-zinc-300 mb-2">{t('settings.otherShortcuts')}</p>
              <div className="space-y-1">
                {[
                  [`${modifierLabel}+1 / 2 / 3 / 4`, t('settings.navShortcuts')],
                  [`${modifierLabel}+,`, t('settings.openSettings')],
                  ['Tab', t('settings.quickModeShortcut')],
                  ['Esc', t('settings.closeShortcut')]
                ].map(([key, desc]) => (
                  <div key={key} className="flex items-center justify-between">
                    <code className="text-xs bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-600 px-1.5 py-0.5 rounded text-zinc-600 dark:text-zinc-400">
                      {key}
                    </code>
                    <span className="text-xs text-zinc-400">{desc}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Appearance */}
          <section id="settings-appearance" className="settings-section">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-1">{t('settings.appearance')}</h2>
            <div className="h-px bg-zinc-200 dark:bg-zinc-700 mb-4" />
            <div className="mb-4">
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">{t('settings.language')}</label>
              <p className="text-xs text-zinc-400 mb-2">{t('settings.languageHelp')}</p>
              <select
                value={appLanguage}
                onChange={(e) => handleAppLanguageChange(e.target.value as AppLanguage)}
                className="px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-md text-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 dark:focus:ring-zinc-700 bg-white dark:bg-zinc-800 dark:text-zinc-100"
              >
                <option value="system">{t('settings.languageSystem')}</option>
                <option value="zh">{t('settings.languageZh')}</option>
                <option value="en">{t('settings.languageEn')}</option>
              </select>
            </div>
            <div className="flex gap-2">
              {([
                { value: 'light', label: t('settings.themeLight'), Icon: Sun },
                { value: 'dark', label: t('settings.themeDark'), Icon: Moon },
                { value: 'system', label: t('settings.themeSystem'), Icon: Monitor }
              ] as const).map(({ value, label, Icon }) => (
                <button
                  key={value}
                  onClick={() => setTheme(value)}
                  className={`ui-choice-option${theme === value ? ' is-selected' : ''}`}
                >
                  <Icon className="w-4 h-4" />
                  {label}
                </button>
              ))}
            </div>
          </section>

          {/* Data management */}
          <section id="settings-data" className="settings-section">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-1">{t('settings.dataManagement')}</h2>
            <div className="h-px bg-zinc-200 dark:bg-zinc-700 mb-4" />
            <WorkLogTransferCard />
            <DatabaseTransferCard />
            <div className="rounded-lg border border-red-200 bg-red-50/60 p-4 dark:border-red-900/60 dark:bg-red-950/20">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-500" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-medium text-red-800 dark:text-red-300">{t('settings.clearDataTitle')}</h3>
                  <p className="mt-1 text-xs leading-relaxed text-red-700/80 dark:text-red-300/80">{t('settings.clearDataDescription')}</p>
                  <p className="mt-1 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">{t('settings.clearDataKeep')}</p>
                  <button
                    type="button"
                    onClick={() => {
                      setClearDataInput('')
                      setClearDataOpen(true)
                    }}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-100 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/50"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                    {t('settings.clearDataButton')}
                  </button>
                </div>
              </div>
            </div>
          </section>

          {/* Updates & About */}
          <section id="settings-updates" className="settings-section">
            <div className="settings-brand-card">
              <div className="settings-brand-card-logo">
                <img src={workpulseLogo} alt="WorkPulse" />
              </div>
              <div className="settings-brand-card-copy">
                <p className="settings-brand-eyebrow">WORKPULSE</p>
                <h2>{t('settings.about')}</h2>
                <p>{t('settings.aboutDescription')}</p>
                <div className="settings-brand-meta">
                  <span>v{currentVersion}</span>
                  <span>{t('settings.productTagline')}</span>
                </div>
              </div>
            </div>

            <div className="settings-update-card">
              <div className="settings-update-card-header">
                <div className="settings-update-card-icon"><RefreshCw aria-hidden="true" /></div>
                <div>
                  <h2>{t('settings.updateTitle')}</h2>
                  <p>{t('settings.updateHelp')}</p>
                </div>
              </div>
              <div className="settings-update-status-row">
                <div className={`settings-update-status settings-update-status-${updateState.status}`}>
                  {updateState.status === 'downloaded' || updateState.status === 'not_available' ? (
                    <CheckCircle2 aria-hidden="true" />
                  ) : updateState.status === 'error' ? (
                    <AlertCircle aria-hidden="true" />
                  ) : (
                    <Download aria-hidden="true" />
                  )}
                  <div>
                    <strong>{t('settings.currentVersion', { version: currentVersion })}</strong>
                    <span>{getUpdateMessage()}</span>
                  </div>
                </div>
                {updateState.status === 'downloading' && (
                  <span className="settings-update-progress-value">{updateState.progress ?? 0}%</span>
                )}
              </div>
              {updateState.status === 'downloading' && (
                <div className="settings-update-progress" aria-label={t('settings.updateDownloading', { progress: updateState.progress ?? 0 })}>
                  <span style={{ width: `${Math.max(0, Math.min(100, updateState.progress ?? 0))}%` }} />
                </div>
              )}
              {onlineUpdatesEnabled && (
                <div className="settings-update-actions">
                  <button type="button" onClick={handleCheckUpdates} disabled={isCheckingUpdate} className="settings-secondary-button">
                    <RefreshCw className={isCheckingUpdate ? 'is-spinning' : ''} aria-hidden="true" />
                    {isCheckingUpdate ? t('settings.checkingUpdates') : t('settings.checkUpdates')}
                  </button>
                  {updateState.status === 'downloaded' && (
                    <button type="button" onClick={handleInstallUpdate} className="settings-primary-button">
                      <Download aria-hidden="true" />
                      {t('settings.restartInstall')}
                    </button>
                  )}
                  {updateState.releaseUrl && (
                    <button type="button" onClick={() => window.open(updateState.releaseUrl, '_blank')} className="settings-secondary-button">
                      <ExternalLink aria-hidden="true" />
                      {t('settings.openRelease')}
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="settings-about-grid">
              <article className="settings-about-card">
                <div className="settings-about-card-icon"><Sparkles aria-hidden="true" /></div>
                <h3>{t('settings.aboutFeaturesTitle')}</h3>
                <p>{t('settings.aboutFeaturesText')}</p>
                <div className="settings-about-points">
                  <span><CheckCircle2 aria-hidden="true" />{t('settings.aboutFeatureNotes')}</span>
                  <span><CheckCircle2 aria-hidden="true" />{t('settings.aboutFeatureGit')}</span>
                  <span><CheckCircle2 aria-hidden="true" />{t('settings.aboutFeatureReports')}</span>
                </div>
              </article>
              <article className="settings-about-card">
                <div className="settings-about-card-icon"><ShieldCheck aria-hidden="true" /></div>
                <h3>{t('settings.aboutPrivacyTitle')}</h3>
                <p>{t('settings.aboutPrivacyText')}</p>
                <button type="button" onClick={() => { void window.api.app.openBackupDir() }} className="settings-secondary-button">
                  <FolderOpen aria-hidden="true" />
                  {t('settings.openBackupDir')}
                </button>
              </article>
            </div>
          </section>
            </div>
          </div>
        </div>
      </main>

      {clearDataOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" role="presentation">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="clear-data-dialog-title"
            className="w-full max-w-md rounded-xl border border-red-200 bg-white p-5 shadow-2xl dark:border-red-900 dark:bg-zinc-900"
          >
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-500" aria-hidden="true" />
              <div>
                <h2 id="clear-data-dialog-title" className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{t('settings.clearDataDialogTitle')}</h2>
                <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">{t('settings.clearDataDialogWarning')}</p>
              </div>
            </div>
            <label htmlFor="clear-data-confirmation" className="mt-4 block text-sm font-medium text-zinc-700 dark:text-zinc-200">
              {t('settings.clearDataTypePrompt')}
            </label>
            <input
              id="clear-data-confirmation"
              type="text"
              value={clearDataInput}
              onChange={(event) => setClearDataInput(event.target.value)}
              placeholder={t('settings.clearDataTypePlaceholder')}
              autoFocus
              disabled={clearingData}
              className="mt-2 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-red-400 focus:ring-2 focus:ring-red-200 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:ring-red-900"
            />
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  if (clearingData) return
                  setClearDataOpen(false)
                  setClearDataInput('')
                }}
                disabled={clearingData}
                className="rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                {t('settings.clearDataCancel')}
              </button>
              <button
                type="button"
                onClick={() => { void handleClearData() }}
                disabled={!canConfirmClearData || clearingData}
                className="rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {clearingData ? t('settings.clearDataClearing') : t('settings.clearDataConfirm')}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

export default SettingsPage

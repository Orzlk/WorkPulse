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
import { DEFAULT_REPORT_TEMPLATE, DEFAULT_REPORT_TEMPLATE_EN, DEFAULT_SYSTEM_PROMPT, DEFAULT_SYSTEM_PROMPT_EN } from '../lib/reportDefaults'
import { WorkspacePageHeader } from '../components/WorkspacePageHeader'
import { DatabaseTransferCard } from '../components/DatabaseTransferCard'
import { WorkLogTransferCard } from '../components/WorkLogTransferCard'
import { useOverlayStack } from '../components/OverlayStack'
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

type SettingsFieldStatus = 'saving' | 'saved' | 'error'

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
  const [fieldSaveStatus, setFieldSaveStatus] = useState<Record<string, SettingsFieldStatus>>({})
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
  const clearDataTriggerRef = useRef<HTMLButtonElement>(null)
  const overlayStack = useOverlayStack()
  const toast = useToast()
  const { theme, setTheme } = useThemeStore()
  const styleOptions = [
    t('settings.styleConcise'),
    t('settings.styleDetailed'),
    t('settings.styleCasual')
  ]

  useEffect(() => {
    void loadSettings().catch(() => toast.error(t('settings.saveFailed')))

    void window.api.app.getVersion().then(setAppVersion).catch(() => undefined)
    void window.api.app.getUpdateState().then(setUpdateState).catch(() => undefined)
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
    try {
      const updated = await window.api.shortcut.update(key, value)
      if (!updated) {
        toast.error(t('settings.shortcutTaken'))
        return
      }

      setter(value)
      toast.success(t('settings.shortcutSaved'))
    } catch {
      toast.error(t('settings.saveFailed'))
    }
  }

  const maskKey = (key: string): string => {
    if (key.length <= 8) return '****'
    return key.slice(0, 4) + '****' + key.slice(-4)
  }

  const handleSaveKey = async (): Promise<void> => {
    if (!apiKey.trim()) return
    try {
      await window.api.settings.set('api_key', apiKey.trim())
      setHasKey(true)
      setEditing(false)
      toast.success(t('settings.apiKeySaved'))
    } catch {
      toast.error(t('settings.saveFailed'))
    }
  }

  const handleDeleteKey = async (): Promise<void> => {
    try {
      await window.api.settings.delete('api_key')
      setApiKey('')
      setHasKey(false)
      setEditing(false)
      toast.success(t('settings.apiKeyDeleted'))
    } catch {
      toast.error(t('settings.saveFailed'))
    }
  }

  const saveSetting = async (key: string, value: string): Promise<void> => {
    if (value.trim()) {
      await window.api.settings.set(key, value.trim())
    } else {
      await window.api.settings.delete(key)
    }
  }

  const clearFieldSaveStatus = (field: string): void => {
    setFieldSaveStatus((current) => {
      const next = { ...current }
      delete next[field]
      return next
    })
  }

  const saveFieldSetting = async (field: string, save: () => Promise<void>): Promise<void> => {
    setFieldSaveStatus((current) => ({ ...current, [field]: 'saving' }))
    try {
      await save()
      setFieldSaveStatus((current) => ({ ...current, [field]: 'saved' }))
    } catch {
      setFieldSaveStatus((current) => ({ ...current, [field]: 'error' }))
    }
  }

  const settingsFieldStatus = (field: string): JSX.Element | null => {
    const status = fieldSaveStatus[field]
    if (!status) return null
    return <span className={`settings-field-status settings-field-status-${status}`} role={status === 'error' ? 'alert' : undefined}>
      {status === 'saving' ? t('settings.saving') : status === 'saved' ? t('settings.saved') : t('settings.saveFailed')}
    </span>
  }

  const handleProviderChange = async (value: AiProvider): Promise<void> => {
    const previous = provider
    setProvider(value)
    try {
      await window.api.settings.set('ai_provider', value)
    } catch {
      setProvider(previous)
      toast.error(t('settings.saveFailed'))
    }
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
    await saveFieldSetting('baseUrl', () => saveSetting('ai_base_url', baseUrl))
  }

  const handleModelBlur = async (): Promise<void> => {
    await saveFieldSetting('model', () => saveSetting('ai_model', model))
  }

  const handleLanguageChange = async (value: string): Promise<void> => {
    const previous = reportLanguage
    setReportLanguage(value)
    try {
      await window.api.settings.set('report_language', value)
    } catch {
      setReportLanguage(previous)
      toast.error(t('settings.saveFailed'))
    }
  }

  const handleStyleChange = async (value: string): Promise<void> => {
    const previous = style
    setStyle(value)
    try {
      await window.api.settings.set('report_style', value)
    } catch {
      setStyle(previous)
      toast.error(t('settings.saveFailed'))
    }
  }

  const handleAppLanguageChange = async (value: AppLanguage): Promise<void> => {
    try {
      await setAppLanguage(value)
    } catch {
      toast.error(t('settings.saveFailed'))
    }
  }

  const handleSystemPromptBlur = async (): Promise<void> => {
    await saveFieldSetting('systemPrompt', async () => {
      if (systemPrompt.trim() === getDefaultSystemPrompt(resolvedLanguage).trim()) {
        await window.api.settings.delete('system_prompt')
      } else {
        await window.api.settings.set('system_prompt', systemPrompt)
      }
    })
  }

  const handleReportTemplateBlur = async (): Promise<void> => {
    await saveFieldSetting('reportTemplate', async () => {
      if (reportTemplate.trim() === getDefaultReportTemplate(resolvedLanguage).trim()) {
        await window.api.settings.delete('report_template')
      } else {
        await window.api.settings.set('report_template', reportTemplate)
      }
    })
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
    const previous = reportReminderPeriod
    setReportReminderPeriod(period)
    try {
      await window.api.settings.set('report_reminder_period', period)
    } catch {
      setReportReminderPeriod(previous)
      toast.error(t('settings.reportReminderSaveFailed'))
    }
  }

  const resetSystemPrompt = async (): Promise<void> => {
    setSystemPrompt(getDefaultSystemPrompt(resolvedLanguage))
    try {
      await window.api.settings.delete('system_prompt')
      toast.success(t('settings.systemPromptReset'))
    } catch {
      toast.error(t('settings.saveFailed'))
    }
  }

  const resetReportTemplate = async (): Promise<void> => {
    setReportTemplate(getDefaultReportTemplate(resolvedLanguage))
    try {
      await window.api.settings.delete('report_template')
      toast.success(t('settings.templateReset'))
    } catch {
      toast.error(t('settings.saveFailed'))
    }
  }

  const handleCheckUpdates = async (): Promise<void> => {
    try {
      const state = await window.api.app.checkForUpdates()
      setUpdateState(state)

      if (state.status === 'not_available') {
        toast.success(t('settings.updateNotAvailable'))
      } else if (state.status === 'error') {
        toast.error(t('settings.updateError', { message: state.error || '' }))
      }
    } catch {
      toast.error(t('settings.updateError', { message: '' }))
    }
  }

  const handleInstallUpdate = async (): Promise<void> => {
    try {
      await window.api.app.installUpdate()
    } catch {
      toast.error(t('settings.updateError', { message: '' }))
    }
  }

  const handleOpenBackupDir = async (): Promise<void> => {
    try {
      await window.api.app.openBackupDir()
    } catch {
      toast.error(t('settings.saveFailed'))
    }
  }

  const clearDataLanguage: 'zh' | 'en' = resolvedLanguage === 'zh' ? 'zh' : 'en'
  const canConfirmClearData = isClearDataConfirmationValid(clearDataInput, clearDataLanguage)
  const requestCloseClearData = (): boolean => {
    if (clearingData) return false
    setClearDataOpen(false)
    setClearDataInput('')
    window.requestAnimationFrame(() => clearDataTriggerRef.current?.focus())
    return true
  }
  useEffect(() => {
    if (!clearDataOpen) return
    return overlayStack.register({ id: 'clear-data-confirmation', priority: 200, requestClose: requestCloseClearData })
  }, [clearDataOpen, clearingData, overlayStack])

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
                    ref={clearDataTriggerRef}
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
                    className="settings-primary-button px-4 text-sm"
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
                onChange={(e) => { setBaseUrl(e.target.value); clearFieldSaveStatus('baseUrl') }}
                onBlur={handleBaseUrlBlur}
                placeholder={provider === 'openai' ? 'https://api.openai.com' : provider === 'deepseek' ? 'https://api.deepseek.com' : 'https://api.anthropic.com'}
                className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-md text-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 dark:focus:ring-zinc-700 bg-white dark:bg-zinc-800 dark:text-zinc-100 font-mono"
              />
              {settingsFieldStatus('baseUrl')}
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
                onChange={(e) => { setModel(e.target.value); clearFieldSaveStatus('model') }}
                onBlur={handleModelBlur}
                placeholder={provider === 'openai' ? 'gpt-4o-mini' : provider === 'deepseek' ? 'deepseek-chat' : 'claude-sonnet-4-20250514'}
                className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-md text-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 dark:focus:ring-zinc-700 bg-white dark:bg-zinc-800 dark:text-zinc-100 font-mono"
              />
              {settingsFieldStatus('model')}
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
                onChange={(e) => { setSystemPrompt(e.target.value); clearFieldSaveStatus('systemPrompt') }}
                onBlur={handleSystemPromptBlur}
                rows={8}
                className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg text-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 dark:focus:ring-zinc-700 bg-white dark:bg-zinc-800 dark:text-zinc-100 font-mono leading-relaxed resize-y"
              />
              {settingsFieldStatus('systemPrompt')}
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
                onChange={(e) => { setReportTemplate(e.target.value); clearFieldSaveStatus('reportTemplate') }}
                onBlur={handleReportTemplateBlur}
                rows={10}
                className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg text-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 dark:focus:ring-zinc-700 bg-white dark:bg-zinc-800 dark:text-zinc-100 font-mono leading-relaxed resize-y"
              />
              {settingsFieldStatus('reportTemplate')}
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
                  [`${modifierLabel}+1 / 2 / 3 / 4 / 5`, t('settings.navShortcuts')],
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
                <button type="button" onClick={() => { void handleOpenBackupDir() }} className="settings-secondary-button">
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
        <div className="hallmark-app portal-root fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" role="presentation">
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
                onClick={requestCloseClearData}
                disabled={clearingData}
                className="rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                {t('settings.clearDataCancel')}
              </button>
              <button
                type="button"
                onClick={() => { void handleClearData() }}
                disabled={!canConfirmClearData || clearingData}
                className="ui-button ui-button--danger text-sm"
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

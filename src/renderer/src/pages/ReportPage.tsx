import { useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import { AlertCircle, Check, ChevronDown, ChevronUp, Clock3, Copy, Download, Eye, FileText, LoaderCircle, Pencil, RefreshCw, Save, Sparkles } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { useToast } from '../components/Toast'
import { buildReportExportName, getHistoryReportState, getLatestCompleteReportAnchor, getReportGenerationError, getRetryReportRequest, hasReportPreviewData, isReportScopeAll, toggleReportScope, type WorkflowReportType } from '../lib/reportWorkflow'
import { useI18n } from '../stores/languageStore'
import { useProjectStore } from '../stores/projectStore'
import { useRepositoryStore } from '../stores/repositoryStore'
import { WorkspacePageHeader } from '../components/WorkspacePageHeader'
import { WorkspaceSectionTabs } from '../components/WorkspaceSectionTabs'

type Status = 'idle' | 'no_key' | 'generating' | 'success' | 'error' | 'no_data'
type Stage = 'idle' | 'reading' | 'git' | 'grouping' | 'generating' | 'failed'

interface Report {
  public_id: string; type: string; timezone: string; project_scope: string[]; repository_scope: string[]; content: string; version: number
  status: 'generating' | 'ready' | 'error'; error_message: string | null; retry_count: number; generated_at: string | null
  display_start: string; display_end_inclusive: string; source_snapshot?: { schema_version: number | string; unavailable?: boolean }
}
interface Preview {
  type: WorkflowReportType; display_start: string; display_end_inclusive: string; project_count: number; repository_count: number
  work_log_count: number; task_count: number; inbox_count: number; git_commit_count: number; unorganized_inbox_count: number
}
interface Props { projectId: string | null; onProjectChange: (projectId: string | null) => void; onOpenInbox: () => void; onOpenStats?: () => void }

const EMPTY_PREVIEW: Preview = { type: 'weekly', display_start: '', display_end_inclusive: '', project_count: 0, repository_count: 0, work_log_count: 0, task_count: 0, inbox_count: 0, git_commit_count: 0, unorganized_inbox_count: 0 }
function ReportPage({ projectId, onProjectChange, onOpenInbox, onOpenStats }: Props): JSX.Element {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  const toast = useToast()
  const { t } = useI18n()
  const projects = useProjectStore((state) => state.items)
  const fetchProjects = useProjectStore((state) => state.fetch)
  const repositories = useRepositoryStore((state) => state.items)
  const fetchRepositories = useRepositoryStore((state) => state.fetch)
  const [type, setType] = useState<WorkflowReportType>('weekly')
  const [anchorDate, setAnchorDate] = useState(() => getLatestCompleteReportAnchor('weekly', timeZone))
  const [projectIds, setProjectIds] = useState<string[]>(projectId ? [projectId] : [])
  const [repositoryIds, setRepositoryIds] = useState<string[]>([])
  const [preview, setPreview] = useState<Preview>(EMPTY_PREVIEW)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [status, setStatus] = useState<Status>('idle')
  const [stage, setStage] = useState<Stage>('idle')
  const [content, setContent] = useState('')
  const [error, setError] = useState('')
  const [history, setHistory] = useState<Report[]>([])
  const [historyOpen, setHistoryOpen] = useState(true)
  const [viewing, setViewing] = useState<Report | null>(null)
  const [active, setActive] = useState<Report | null>(null)
  const [editing, setEditing] = useState(false)
  const [copied, setCopied] = useState(false)
  const timers = useRef<number[]>([])
  const activeStreamId = useRef<string | null>(null)
  const request = useMemo(() => ({ type, anchorDate, timeZone, projectIds, repositoryIds }), [anchorDate, projectIds, repositoryIds, timeZone, type])

  const clearTimers = (): void => { timers.current.forEach(window.clearTimeout); timers.current = [] }
  const loadHistory = async (): Promise<void> => {
    try { setHistory(await window.api.report.list(100) as Report[]) } catch { toast.error(t('report.historyLoadFailed')) }
  }
  const checkKey = async (): Promise<void> => { if (!await window.api.settings.get('api_key')) setStatus('no_key') }

  useEffect(() => {
    void fetchProjects(); void fetchRepositories(); void loadHistory(); void checkKey()
    const unsubscribe = window.api.on.reportStream((event) => {
      if (event.request_id !== activeStreamId.current) return
      if (event.type === 'stage') {
        setStage(event.stage === 'reading' ? 'reading' : 'generating')
        return
      }
      if (event.type === 'chunk') {
        setContent((current) => current + (event.chunk ?? ''))
        return
      }
      activeStreamId.current = null
      clearTimers()
      if (event.type === 'done' && event.report) {
        const report = event.report as Report
        setActive(report)
        setContent(report.content)
        setStatus(report.content ? 'success' : 'no_data')
        setStage('idle')
        void loadHistory()
        return
      }
      setStage('failed')
      setError(event.code === 'cancelled' ? t('common.cancel') : t('report.error.unknown'))
      setStatus('error')
    })
    return () => {
      unsubscribe()
      clearTimers()
      const requestId = activeStreamId.current
      if (requestId) void window.api.report.cancel(requestId)
      activeStreamId.current = null
    }
  }, [fetchProjects, fetchRepositories])
  useEffect(() => {
    let closed = false
    setPreviewLoading(true)
    const timer = window.setTimeout(() => void window.api.report.preview(request).then((value) => {
      if (!closed) setPreview(value)
    }).catch(() => {
      if (!closed) toast.error(t('report.previewFailed'))
    }).finally(() => { if (!closed) setPreviewLoading(false) }), 160)
    return () => { closed = true; window.clearTimeout(timer) }
  }, [request])

  const chooseType = (next: WorkflowReportType): void => {
    setType(next); setAnchorDate(getLatestCompleteReportAnchor(next, timeZone))
  }
  const generate = async (input: typeof request | MouseEvent<HTMLButtonElement> = request, bypassEmptyPreview = false): Promise<void> => {
    if (status === 'no_key' || previewLoading) return
    if (!bypassEmptyPreview && !hasReportPreviewData(preview)) {
      setStatus('no_data'); setStage('idle'); return
    }
    const inputRequest = 'anchorDate' in input ? input : request
    setStatus('generating'); setError(''); setViewing(null); setActive(null); setContent(''); setStage('reading')
    try {
      activeStreamId.current = await window.api.report.startStream(inputRequest)
    } catch (cause) {
      activeStreamId.current = null
      clearTimers(); setStage('failed'); setError(t(`report.error.${getReportGenerationError(cause)}`)); setStatus('error')
    }
  }
  const cancelGeneration = async (): Promise<void> => {
    const requestId = activeStreamId.current
    if (!requestId) return
    try {
      await window.api.report.cancel(requestId)
    } catch {
      setError(t('common.cancel'))
      setStatus('error')
    }
  }
  const retryActiveReport = (): void => {
    if (!active || active.status !== 'error') return
    const retryRequest = getRetryReportRequest(active)
    setType(retryRequest.type)
    setAnchorDate(retryRequest.anchorDate)
    setProjectIds(retryRequest.projectIds)
    setRepositoryIds(retryRequest.repositoryIds)
    setViewing(null)
    void generate(retryRequest, true)
  }
  const save = async (): Promise<void> => {
    if (!active) return
    try {
      const report = await window.api.report.update(active.public_id, { content }) as Report | null
      if (!report) throw new Error('Report not found')
      setActive(report); setViewing(report); setContent(report.content); setEditing(false); await loadHistory(); toast.success(t('report.saved'))
    } catch { toast.error(t('report.saveFailed')) }
  }
  const copy = async (): Promise<void> => {
    try { await navigator.clipboard.writeText(content); setCopied(true); window.setTimeout(() => setCopied(false), 2000); toast.success(t('report.copied')) } catch { toast.error(t('report.copyFailed')) }
  }
  const displayScope = (ids: string[], values: Array<{ public_id: string; name: string }>, fallback: string): string => {
    const names = values.filter((item) => ids.includes(item.public_id)).map((item) => item.name)
    return names.length ? names.join('、') : fallback
  }
  const hasSourceData = preview.work_log_count + preview.task_count + preview.inbox_count + preview.git_commit_count > 0
  const isHistory = viewing !== null

  return <div className="mx-auto max-w-6xl space-y-6 pb-10">
    <WorkspacePageHeader ariaLabel={t('workspace.breadcrumbLabel')} items={isHistory ? [{ label: t('nav.report'), onClick: () => { setViewing(null); setActive(null); setContent(''); setStatus('idle'); setEditing(false) } }, { label: t('report.history'), current: true }] : [{ label: t('nav.report'), current: true }]} title={t('report.workflowTitle')} description={t('report.workflowSubtitle')} />
    <WorkspaceSectionTabs ariaLabel={t('workspace.sectionNavigation')} items={[{ id: 'reports', label: t('nav.report'), active: true }, { id: 'stats', label: t('nav.stats'), onClick: onOpenStats }]} />
    {isHistory ? <HistoryHeader report={viewing} onBack={() => { setViewing(null); setActive(null); setContent(''); setStatus('idle'); setEditing(false) }} t={t} timeZone={timeZone} /> : <>
      <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
        <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold tracking-[0.16em] text-zinc-500">{t('report.kicker')}</p><h1 className="mt-1 text-xl font-semibold text-zinc-900 dark:text-zinc-100">{t('report.workflowTitle')}</h1><p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{t('report.workflowSubtitle')}</p></div><span className="rounded-full bg-zinc-100 px-3 py-1 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{timeZone}</span></div>
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <fieldset><legend className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{t('report.typeLabel')}</legend><div className="mt-2 flex gap-2">{(['weekly', 'monthly'] as const).map((value) => <button key={value} type="button" aria-pressed={type === value} onClick={() => chooseType(value)} className={`min-h-10 rounded-lg px-4 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-zinc-400 ${type === value ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900' : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700'}`}>{value === 'weekly' ? t('report.weekly') : t('report.monthly')}</button>)}</div><label htmlFor="report-anchor" className="mt-4 block text-sm font-medium text-zinc-800 dark:text-zinc-200">{t('report.anchorDate')}</label><div className="mt-2 flex flex-wrap gap-2"><input id="report-anchor" type="date" value={anchorDate} onChange={(event) => setAnchorDate(event.target.value)} className="min-h-10 rounded-lg border border-zinc-300 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100" /><button type="button" onClick={() => setAnchorDate(getLatestCompleteReportAnchor(type, timeZone))} className="min-h-10 rounded-lg px-3 text-sm text-zinc-600 hover:bg-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:text-zinc-300 dark:hover:bg-zinc-800">{type === 'weekly' ? t('report.latestCompleteWeek') : t('report.latestCompleteMonth')}</button></div></fieldset>
          <div className="space-y-4"><Picker label={t('report.projectScope')} items={projects} ids={projectIds} allLabel={t('report.allProjects')} onSelectAll={() => { setProjectIds([]); onProjectChange(null) }} onToggle={(id) => { const next = toggleReportScope(projectIds, id); setProjectIds(next); if (next.length <= 1) onProjectChange(next[0] ?? null) }} /><Picker label={t('report.repositoryScope')} items={repositories} ids={repositoryIds} allLabel={t('report.allRepositories')} onSelectAll={() => setRepositoryIds([])} onToggle={(id) => setRepositoryIds(toggleReportScope(repositoryIds, id))} /></div>
        </div>
      </section>
      <section className="rounded-xl border border-zinc-200 bg-zinc-50 p-5 dark:border-zinc-700 dark:bg-zinc-900/60" aria-live="polite"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{t('report.previewTitle')}</h2><p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{previewLoading ? t('report.previewLoading') : `${preview.display_start || '—'} ${t('common.to')} ${preview.display_end_inclusive || '—'}`}</p></div><span className="text-xs text-zinc-500">{t('report.previewTimezone', { timeZone })}</span></div><div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6"><Metric label={t('report.previewProjects')} value={preview.project_count} /><Metric label={t('report.previewRepositories')} value={preview.repository_count} /><Metric label={t('report.previewLogs')} value={preview.work_log_count} /><Metric label={t('report.previewTasks')} value={preview.task_count} /><Metric label={t('report.previewInbox')} value={preview.inbox_count} /><Metric label={t('report.previewGit')} value={preview.git_commit_count} /></div>{preview.unorganized_inbox_count > 0 && <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-200"><span className="flex items-center gap-2"><AlertCircle className="h-4 w-4" aria-hidden="true" />{t('report.unorganizedReminder', { count: preview.unorganized_inbox_count })}</span><button type="button" onClick={onOpenInbox} className="min-h-9 rounded-md px-2 font-medium underline underline-offset-4 focus:outline-none focus:ring-2 focus:ring-amber-600">{t('report.openInbox')}</button></div>}<p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">{t('report.inboxReminder')}</p></section>
      <button type="button" onClick={() => status === 'generating' ? void cancelGeneration() : void generate()} disabled={status === 'no_key' || previewLoading} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-zinc-900 px-5 text-sm font-medium text-white hover:bg-zinc-700 focus:outline-none focus:ring-2 focus:ring-zinc-400 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 dark:focus:ring-offset-zinc-950">{status === 'generating' ? <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}{status === 'generating' ? t('common.cancel') : t('report.generate')}</button>
    </>}
    {status === 'generating' && content && <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900" aria-live="polite"><div className="mb-3 flex items-center gap-2 text-sm font-medium text-zinc-600 dark:text-zinc-300"><LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />{t('report.generating')}</div><div className="prose prose-zinc max-w-none dark:prose-invert" role="article"><ReactMarkdown>{content}</ReactMarkdown></div></section>}
    {status === 'no_key' && !isHistory && <Notice tone="warning" title={t('report.noKeyTitle')} detail={t('report.noKeySubtitle')} />}
    {status === 'error' && <Notice tone="error" title={error} detail={active ? t('report.errorWithRetryCount', { count: active.retry_count }) : t('report.error.retryHint')} action={<button type="button" onClick={() => active?.status === 'error' ? retryActiveReport() : void generate()} className="min-h-9 rounded-md px-2 text-sm font-medium underline underline-offset-4 focus:outline-none focus:ring-2 focus:ring-red-500">{t('common.retry')}</button>} />}
    {status === 'no_data' && !isHistory && <Notice tone="neutral" title={t('report.noDataTitle')} detail={t('report.noDataSubtitle')} />}
    {!hasSourceData && !previewLoading && status === 'idle' && !isHistory && <p className="text-sm text-zinc-500 dark:text-zinc-400">{t('report.previewEmpty')}</p>}
    {status === 'success' && content && <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div className="flex rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800" role="group" aria-label={t('report.viewMode')}><button type="button" aria-pressed={!editing} onClick={() => setEditing(false)} className={`inline-flex min-h-9 items-center gap-1 rounded-md px-3 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400 ${!editing ? 'bg-white shadow-sm dark:bg-zinc-700' : 'text-zinc-600 dark:text-zinc-300'}`}><Eye className="h-4 w-4" aria-hidden="true" />{t('report.preview')}</button><button type="button" aria-pressed={editing} onClick={() => setEditing(true)} className={`inline-flex min-h-9 items-center gap-1 rounded-md px-3 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400 ${editing ? 'bg-white shadow-sm dark:bg-zinc-700' : 'text-zinc-600 dark:text-zinc-300'}`}><Pencil className="h-4 w-4" aria-hidden="true" />{t('report.edit')}</button></div>{active && <span className="text-xs text-zinc-500">{t('report.version', { version: active.version })}</span>}</div>{editing ? <textarea aria-label={t('report.edit')} value={content} onChange={(event) => setContent(event.target.value)} className="min-h-[360px] w-full rounded-lg border border-zinc-300 bg-white p-4 font-mono text-sm leading-relaxed outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100" /> : <div className="prose prose-zinc max-w-none dark:prose-invert" role="article"><ReactMarkdown>{content}</ReactMarkdown></div>}<div className="mt-5 flex flex-wrap gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-700"><button type="button" onClick={copy} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-700 focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:bg-zinc-100 dark:text-zinc-900">{copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}{copied ? t('report.copiedState') : t('report.copy')}</button><button type="button" onClick={async () => { const report = viewing ?? active; if (report && await window.api.export.report(content, buildReportExportName(report))) toast.success(t('report.exported')) }} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-zinc-300 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-600 dark:text-zinc-200"><Download className="h-4 w-4" aria-hidden="true" />{t('common.export')}</button>{editing && <button type="button" onClick={save} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-zinc-300 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-600 dark:text-zinc-200"><Save className="h-4 w-4" aria-hidden="true" />{t('report.saveCurrentVersion')}</button>}{!isHistory && <button type="button" onClick={generate} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-zinc-300 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-600 dark:text-zinc-200"><RefreshCw className="h-4 w-4" aria-hidden="true" />{t('report.regenerate')}</button>}</div></section>}
    {!isHistory && <section className="border-t border-zinc-200 pt-5 dark:border-zinc-700"><button type="button" onClick={() => setHistoryOpen((value) => !value)} aria-expanded={historyOpen} className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-zinc-800 focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:text-zinc-200"><Clock3 className="h-4 w-4" aria-hidden="true" />{t('report.history')}<span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-normal dark:bg-zinc-800">{history.length}</span>{historyOpen ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}</button>{historyOpen && <div className="mt-3 space-y-2">{history.map((report) => <button key={report.public_id} type="button" onClick={() => { const state = getHistoryReportState(report); setViewing(report); setActive(report); setContent(report.content); setStatus(state.status === 'error' ? 'error' : state.status === 'ready' ? 'success' : 'generating'); setError(state.errorMessage ?? ''); setStage(state.status === 'error' ? 'failed' : 'idle'); setEditing(false) }} className="flex w-full items-start justify-between gap-4 rounded-xl border border-zinc-200 bg-white p-4 text-left hover:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-900"><span className="min-w-0"><span className="flex flex-wrap items-center gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-200"><FileText className="h-4 w-4" aria-hidden="true" />{report.type === 'weekly' ? t('report.weekly') : t('report.monthly')} · {report.display_start} {t('common.to')} {report.display_end_inclusive}<Badge status={report.status} t={t} /></span><span className="mt-1 block truncate text-xs text-zinc-500">{t('report.historyScope', { projects: displayScope(report.project_scope, projects, t('report.allProjects')), repositories: displayScope(report.repository_scope, repositories, t('report.allRepositories')) })}</span></span><span className="shrink-0 text-right text-xs text-zinc-500">{t('report.version', { version: report.version })}<br />{formatTime(report.generated_at, timeZone)}</span></button>)}</div>}</section>}
  </div>
}

function Picker({ label, items, ids, allLabel, onSelectAll, onToggle }: { label: string; items: Array<{ public_id: string; name: string }>; ids: string[]; allLabel: string; onSelectAll: () => void; onToggle: (id: string) => void }): JSX.Element {
  return <fieldset><legend className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{label}</legend><p className="mt-1 text-xs text-zinc-500">{ids.length ? `${ids.length} ${label}` : allLabel}</p><div className="mt-2 flex max-h-28 flex-wrap gap-2 overflow-y-auto"><button type="button" aria-pressed={isReportScopeAll(ids)} onClick={onSelectAll} className={`min-h-9 rounded-md border px-3 text-xs focus:outline-none focus:ring-2 focus:ring-zinc-400 ${isReportScopeAll(ids) ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900' : 'border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800'}`}>{allLabel}</button>{items.map((item) => <button key={item.public_id} type="button" aria-pressed={ids.includes(item.public_id)} onClick={() => onToggle(item.public_id)} className={`min-h-9 rounded-md border px-3 text-xs focus:outline-none focus:ring-2 focus:ring-zinc-400 ${ids.includes(item.public_id) ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900' : 'border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800'}`}>{item.name}</button>)}</div></fieldset>
}
function Metric({ label, value }: { label: string; value: number }): JSX.Element { return <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"><p className="text-xs text-zinc-500">{label}</p><p className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-100">{value}</p></div> }
function Notice({ tone, title, detail, action }: { tone: 'warning' | 'error' | 'neutral'; title: string; detail: string; action?: JSX.Element }): JSX.Element { const style = tone === 'warning' ? 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-100' : tone === 'error' ? 'border-red-200 bg-red-50 text-red-900 dark:border-red-900/70 dark:bg-red-950/30 dark:text-red-100' : 'border-zinc-200 bg-zinc-50 text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200'; return <section className={`flex gap-3 rounded-xl border p-4 ${style}`} role={tone === 'error' ? 'alert' : 'status'}><AlertCircle className="h-5 w-5 shrink-0" aria-hidden="true" /><div><p className="text-sm font-medium">{title}</p><p className="mt-1 text-sm opacity-80">{detail}</p>{action && <div className="mt-2">{action}</div>}</div></section> }
function Badge({ status, t }: { status: Report['status']; t: (key: any, values?: Record<string, string | number>) => string }): JSX.Element { const style = status === 'ready' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' : status === 'error' ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200' : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200'; return <span className={`rounded-full px-2 py-0.5 text-xs font-normal ${style}`}>{t(`report.status.${status}`)}</span> }
function HistoryHeader({ report, onBack, t, timeZone }: { report: Report; onBack: () => void; t: (key: any, values?: Record<string, string | number>) => string; timeZone: string }): JSX.Element { return <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900"><button type="button" onClick={onBack} className="mb-3 min-h-9 text-sm text-zinc-600 underline underline-offset-4 focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:text-zinc-300">{t('report.backToGenerate')}</button><div className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-zinc-600 dark:text-zinc-300"><strong className="text-zinc-900 dark:text-zinc-100">{report.type === 'weekly' ? t('report.weekly') : t('report.monthly')}</strong><span>{report.display_start} {t('common.to')} {report.display_end_inclusive}</span><span>{t('report.version', { version: report.version })}</span><span>{formatTime(report.generated_at, timeZone)}</span></div>{report.source_snapshot?.unavailable && <p className="mt-3 flex items-center gap-2 text-sm text-amber-700 dark:text-amber-300"><AlertCircle className="h-4 w-4" aria-hidden="true" />{t('report.legacySourceUnavailable')}</p>}</section> }
function formatTime(value: string | null, timeZone: string): string { if (!value) return '—'; try { return new Intl.DateTimeFormat(undefined, { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)) } catch { return value } }

export default ReportPage

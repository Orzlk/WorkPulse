import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { ClipboardList, Inbox, ListChecks, X } from 'lucide-react'
import { useWorkLogStore } from '../stores/worklogStore'
import { useInboxStore } from '../stores/inboxStore'
import { useProjectStore } from '../stores/projectStore'
import { useTaskStore } from '../stores/taskStore'
import { useI18n } from '../stores/languageStore'
import { useToast } from './Toast'
import { extractHashTags } from '../lib/workspaceInteractions'
import type { TaskPriority } from '../lib/kanbanTypes'
import { buildTaskCreateRoute } from '../lib/taskCreateRoute'
import { useOverlayStack } from './OverlayStack'

type Mode = 'log' | 'inbox' | 'task'
interface Props { initialMode: Mode; onClose: () => void; returnFocusRef?: RefObject<HTMLElement> }

const modes: Array<{ id: Mode; labelKey: 'workspace.modeLog' | 'workspace.modeInbox' | 'workspace.modeTask'; Icon: typeof ClipboardList }> = [
  { id: 'log', labelKey: 'workspace.modeLog', Icon: ClipboardList },
  { id: 'inbox', labelKey: 'workspace.modeInbox', Icon: Inbox },
  { id: 'task', labelKey: 'workspace.modeTask', Icon: ListChecks }
]

const PRIORITIES: TaskPriority[] = ['low', 'medium', 'high']

export function QuickCreate({ initialMode, onClose, returnFocusRef }: Props): JSX.Element {
  const [mode, setMode] = useState<Mode>(initialMode)
  const [value, setValue] = useState('')
  const [projectId, setProjectId] = useState('')
  const [priority, setPriority] = useState<TaskPriority>('medium')
  const [status, setStatus] = useState<'idle' | 'running' | 'success' | 'error'>('idle')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const addLog = useWorkLogStore((state) => state.addLog)
  const addInbox = useInboxStore((state) => state.create)
  const addTask = useTaskStore((state) => state.addTask)
  const projects = useProjectStore((state) => state.items)
  const fetchProjects = useProjectStore((state) => state.fetch)
  const toast = useToast()
  const { t } = useI18n()
  const overlayStack = useOverlayStack()
  const tags = extractHashTags(value).tags

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    inputRef.current?.focus()
    void fetchProjects()
    return () => {
      const target = returnFocusRef?.current ?? previousFocusRef.current
      if (target && document.contains(target)) target.focus()
    }
  }, [fetchProjects, returnFocusRef])

  useEffect(() => {
    setMode(initialMode)
  }, [initialMode])

  useEffect(() => { inputRef.current?.focus() }, [mode])

  // 内容越多输入区越高，超过上限后内部滚动
  useLayoutEffect(() => {
    const element = inputRef.current
    if (!element) return
    element.style.height = 'auto'
    const content = element.scrollHeight
    element.style.height = `${Math.min(Math.max(content, 62), 200)}px`
    element.style.overflowY = content > 200 ? 'auto' : 'hidden'
  }, [value, mode])

  const requestClose = (): boolean => {
    if (status === 'running') return false
    if (value.trim() && !window.confirm(t('workspace.quickDiscardConfirm'))) return false
    onClose()
    return true
  }

  useEffect(() => overlayStack.register({ id: 'quick-create', priority: 80, requestClose }), [overlayStack, requestClose])

  const handleDialogKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key !== 'Tab' || !dialogRef.current) return
    const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'))
    if (focusable.length === 0) return
    const currentIndex = focusable.indexOf(document.activeElement as HTMLElement)
    const nextIndex = event.shiftKey
      ? (currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1)
      : (currentIndex === focusable.length - 1 ? 0 : currentIndex + 1)
    if (currentIndex < 0 || currentIndex === focusable.length - 1 || (event.shiftKey && currentIndex === 0)) {
      event.preventDefault()
      focusable[nextIndex].focus()
    }
  }

  const submit = async (): Promise<void> => {
    const content = value.trim()
    if (!content || status === 'running') return
    setStatus('running')
    const associations = { project_id: projectId || null, tag_names: tags }
    try {
      if (mode === 'log') await addLog(content, tags[0] ?? '', associations)
      if (mode === 'inbox') await addInbox({ content, project_id: projectId || null, tag_names: tags, include_in_reports: true, ai_suggestion: null })
      if (mode === 'task') await addTask(content, undefined, 'todo', undefined, associations, priority)
      setValue('')
      setStatus('success')
      toast.success(t('workspace.quickSaveSuccess'))
      inputRef.current?.focus()
      window.setTimeout(() => setStatus('idle'), 1400)
    } catch {
      setStatus('error')
      toast.error(t('workspace.quickSaveError'))
    }
  }

  const openFullTaskForm = (): void => {
    const draft = { content: value, projectId, priority }
    void window.api.taskCreateWindow.open({ ...draft, route: buildTaskCreateRoute(draft) })
    onClose()
  }

  const placeholder = mode === 'inbox'
    ? t('workspace.quickInboxPlaceholder')
    : mode === 'task'
      ? t('workspace.quickTaskPlaceholder')
      : t('workspace.quickLogPlaceholder')

  return <div className="quick-create-backdrop" role="presentation" onMouseDown={requestClose}>
    <section ref={dialogRef} className="quick-create-panel" role="dialog" aria-modal="true" aria-labelledby="quick-create-title" tabIndex={-1} onKeyDown={handleDialogKeyDown} onMouseDown={(event) => event.stopPropagation()}>
      <div className="quick-create-header"><div><p className="workspace-kicker">{t('workspace.quickKicker')}</p><h2 id="quick-create-title">{t('workspace.quickDialogTitle')}</h2></div><button onClick={requestClose} aria-label={t('workspace.close')}><X aria-hidden="true" /></button></div>
      <div className="quick-create-tabs" role="tablist" aria-label={t('workspace.createType')}>{modes.map(({ id, labelKey, Icon }) => <button role="tab" aria-selected={mode === id} key={id} onClick={() => setMode(id)}><Icon aria-hidden="true" />{t(labelKey)}</button>)}</div>
      <label className="quick-create-content-label" htmlFor="quick-create-content">{t('workspace.quickContentLabel')}</label>
      <textarea id="quick-create-content" ref={inputRef} rows={1} value={value} disabled={status === 'running'} onChange={(event) => setValue(event.target.value)} className="quick-create-input" placeholder={placeholder} />
      <div className="quick-create-meta">{tags.length > 0 ? <span>{tags.map((tag) => <i key={tag}>#{tag}</i>)}</span> : <span>{t('workspace.quickHelp')}</span>}</div>
      <div className="quick-create-associations">
        <label>{t('workspace.project')}<select value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">{t('workspace.unassigned')}</option>{projects.map((project) => <option key={project.public_id} value={project.public_id}>{project.name}</option>)}</select></label>
        {mode === 'task' && <label>{t('kanban.priority')}<select value={priority} onChange={(event) => setPriority(event.target.value as TaskPriority)}><option value="low">{t('kanban.priorityLow')}</option><option value="medium">{t('kanban.priorityMedium')}</option><option value="high">{t('kanban.priorityHigh')}</option></select></label>}
      </div>
      <footer><span aria-live="polite">{status === 'success' ? t('workspace.quickSaveSuccess') : status === 'error' ? t('workspace.quickSaveError') : t('workspace.quickKeyboardHelp')}</span><div className="quick-create-footer-actions">{mode === 'task' && <button className="ui-button text-xs" onClick={openFullTaskForm}>{t('workspace.quickTaskFullForm')}</button>}<button className="primary-action" onClick={() => void submit()} disabled={!value.trim() || status === 'running'}>{status === 'running' ? t('workspace.saving') : t('common.save')}</button></div></footer>
    </section>
  </div>
}

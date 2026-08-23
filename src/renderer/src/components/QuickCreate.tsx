import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { ClipboardList, Columns3, Inbox, X } from 'lucide-react'
import { useWorkLogStore } from '../stores/worklogStore'
import { useTaskStore } from '../stores/taskStore'
import { useInboxStore } from '../stores/inboxStore'
import { useProjectStore } from '../stores/projectStore'
import { useRepositoryStore } from '../stores/repositoryStore'
import { useI18n } from '../stores/languageStore'
import { useToast } from './Toast'
import { extractHashTags } from '../lib/workspaceInteractions'

type Mode = 'log' | 'task' | 'inbox'
interface Props { initialMode: Mode; onClose: () => void; returnFocusRef?: RefObject<HTMLElement> }

const modes: Array<{ id: Mode; labelKey: 'workspace.modeLog' | 'workspace.modeTask' | 'workspace.modeInbox'; Icon: typeof ClipboardList }> = [
  { id: 'log', labelKey: 'workspace.modeLog', Icon: ClipboardList },
  { id: 'task', labelKey: 'workspace.modeTask', Icon: Columns3 },
  { id: 'inbox', labelKey: 'workspace.modeInbox', Icon: Inbox }
]

export function QuickCreate({ initialMode, onClose, returnFocusRef }: Props): JSX.Element {
  const [mode, setMode] = useState<Mode>(initialMode)
  const [value, setValue] = useState('')
  const [projectId, setProjectId] = useState('')
  const [repositoryId, setRepositoryId] = useState('')
  const [status, setStatus] = useState<'idle' | 'running' | 'success' | 'error'>('idle')
  const inputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const addLog = useWorkLogStore((state) => state.addLog)
  const addTask = useTaskStore((state) => state.addTask)
  const addInbox = useInboxStore((state) => state.create)
  const projects = useProjectStore((state) => state.items)
  const fetchProjects = useProjectStore((state) => state.fetch)
  const repositories = useRepositoryStore((state) => state.items)
  const fetchRepositories = useRepositoryStore((state) => state.fetch)
  const toast = useToast()
  const { t } = useI18n()
  const tags = extractHashTags(value).tags

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    inputRef.current?.focus()
    void fetchProjects()
    void fetchRepositories()
    return () => {
      const target = returnFocusRef?.current ?? previousFocusRef.current
      if (target && document.contains(target)) target.focus()
    }
  }, [fetchProjects, fetchRepositories, returnFocusRef])

  useEffect(() => { inputRef.current?.focus() }, [mode])

  const handleDialogKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
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
    const associations = { project_id: projectId || null, repository_id: repositoryId || null, tag_names: tags }
    try {
      if (mode === 'log') await addLog(content, tags[0] ?? '', associations)
      if (mode === 'task') await addTask(content, undefined, undefined, undefined, associations)
      if (mode === 'inbox') await addInbox({ content, project_id: projectId || null, repository_id: repositoryId || null, tag_names: tags, include_in_reports: true, ai_suggestion: null })
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

  const placeholder = mode === 'inbox' ? t('workspace.quickInboxPlaceholder') : mode === 'task' ? t('workspace.quickTaskPlaceholder') : t('workspace.quickLogPlaceholder')

  return <div className="quick-create-backdrop" role="presentation" onMouseDown={onClose}>
    <section ref={dialogRef} className="quick-create-panel" role="dialog" aria-modal="true" aria-labelledby="quick-create-title" tabIndex={-1} onKeyDown={handleDialogKeyDown} onMouseDown={(event) => event.stopPropagation()}>
      <div className="quick-create-header"><div><p className="workspace-kicker">{t('workspace.quickKicker')}</p><h2 id="quick-create-title">{t('workspace.quickDialogTitle')}</h2></div><button onClick={onClose} aria-label={t('workspace.close')}><X aria-hidden="true" /></button></div>
      <div className="quick-create-tabs" role="tablist" aria-label={t('workspace.createType')}>{modes.map(({ id, labelKey, Icon }) => <button role="tab" aria-selected={mode === id} key={id} onClick={() => setMode(id)}><Icon aria-hidden="true" />{t(labelKey)}</button>)}</div>
      <label className="quick-create-content-label" htmlFor="quick-create-content">{t('workspace.quickContentLabel')}</label>
      <input id="quick-create-content" ref={inputRef} value={value} disabled={status === 'running'} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void submit() }} className="quick-create-input" placeholder={placeholder} />
      <div className="quick-create-meta">{tags.length > 0 ? <span>{tags.map((tag) => <i key={tag}>#{tag}</i>)}</span> : <span>{t('workspace.quickHelp')}</span>}</div>
      <div className="quick-create-associations"><label>{t('workspace.project')}<select value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">{t('workspace.unassigned')}</option>{projects.map((project) => <option key={project.public_id} value={project.public_id}>{project.name}</option>)}</select></label><label>{t('workspace.repository')}<select value={repositoryId} onChange={(event) => setRepositoryId(event.target.value)}><option value="">{t('workspace.unassigned')}</option>{repositories.map((repository) => <option key={repository.public_id} value={repository.public_id}>{repository.name}</option>)}</select></label></div>
      <footer><span aria-live="polite">{status === 'success' ? t('workspace.quickSaveSuccess') : status === 'error' ? t('workspace.quickSaveError') : t('workspace.quickKeyboardHelp')}</span><button className="primary-action" onClick={() => void submit()} disabled={!value.trim() || status === 'running'}>{status === 'running' ? t('workspace.saving') : t('common.save')}</button></footer>
    </section>
  </div>
}

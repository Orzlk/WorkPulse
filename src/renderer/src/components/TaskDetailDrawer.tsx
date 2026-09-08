import { useEffect, useRef, useState } from 'react'
import { Calendar, Check, Plus, Trash2, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import { extractHashTags } from '../lib/workspaceInteractions'
import { useI18n } from '../stores/languageStore'
import type { KanbanColumn, KanbanTask, TaskPriority, TaskUpdates } from '../lib/kanbanTypes'
import { registerNavigationGuard } from '../lib/navigationGuard'
import { useOverlayStack } from './OverlayStack'

interface TaskDetailDrawerProps {
  task: KanbanTask
  columns: KanbanColumn[]
  projects: { public_id: string; name: string }[]
  onClose: () => void
  onSave: (id: number, updates: TaskUpdates) => Promise<void>
  onMove: (id: number, columnKey: string) => Promise<void>
  onReopen: (id: number) => Promise<void>
  onDelete: (id: number) => Promise<void>
  columnName: (columnKey: string) => string
}

export function TaskDetailDrawer({ task, columns, projects, onClose, onSave, onMove, onReopen, onDelete, columnName }: TaskDetailDrawerProps): JSX.Element {
  const { t } = useI18n()
  const [title, setTitle] = useState(task.title)
  const [description, setDescription] = useState(task.description)
  const [priority, setPriority] = useState<TaskPriority>(task.priority)
  const [dueDate, setDueDate] = useState(task.due_date ?? '')
  const [projectId, setProjectId] = useState(task.project_id ?? '')
  const [tags, setTags] = useState(task.tag_names.map((tag) => `#${tag}`).join(' '))
  const [checklist, setChecklist] = useState(task.checklist)
  const [checklistDraft, setChecklistDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedSnapshot, setSavedSnapshot] = useState(() => JSON.stringify({
    title: task.title,
    description: task.description,
    priority: task.priority,
    dueDate: task.due_date ?? '',
    projectId: task.project_id ?? '',
    tags: task.tag_names.map((tag) => `#${tag}`).join(' '),
    checklist: task.checklist
  }))
  const drawerRef = useRef<HTMLElement>(null)
  const overlayStack = useOverlayStack()

  const currentSnapshot = JSON.stringify({ title, description, priority, dueDate, projectId, tags, checklist })
  const isDirty = currentSnapshot !== savedSnapshot

  useEffect(() => {
    const nextTags = task.tag_names.map((tag) => `#${tag}`).join(' ')
    setTitle(task.title); setDescription(task.description); setPriority(task.priority); setDueDate(task.due_date ?? ''); setProjectId(task.project_id ?? ''); setTags(nextTags); setChecklist(task.checklist); setChecklistDraft('')
    setSavedSnapshot(JSON.stringify({ title: task.title, description: task.description, priority: task.priority, dueDate: task.due_date ?? '', projectId: task.project_id ?? '', tags: nextTags, checklist: task.checklist }))
  }, [task])

  const handleSave = async (): Promise<void> => {
    if (!title.trim()) return
    setSaving(true)
    try {
      await onSave(task.id, { title: title.trim(), description: description.trim(), priority, due_date: dueDate || null, project_id: projectId || null, tag_names: extractHashTags(tags).tags, checklist })
      setSavedSnapshot(currentSnapshot)
    } finally {
      setSaving(false)
    }
  }

  const requestClose = (): boolean => {
    if (saving) return false
    if (isDirty && !window.confirm(t('kanban.discardChangesConfirm'))) return false
    onClose()
    return true
  }

  useEffect(() => overlayStack.register({
    id: `task-detail-${task.public_id}`,
    priority: 100,
    dirty: isDirty,
    requestClose
  }), [isDirty, overlayStack, task.public_id])

  useEffect(() => registerNavigationGuard({
    id: `task-detail-${task.public_id}`,
    priority: 100,
    request: requestClose
  }), [isDirty, task.public_id])

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null
    drawerRef.current?.focus()
    const handleDocumentKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab' || !drawerRef.current) return
      const focusable = Array.from(drawerRef.current.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter((element) => !element.hasAttribute('disabled'))
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', handleDocumentKeyDown, true)
    return () => {
      document.removeEventListener('keydown', handleDocumentKeyDown, true)
      previousFocus?.focus()
    }
  }, [])

  const handleMove = async (target: string): Promise<void> => {
    if (target === task.board_column) return
    if (isDirty) {
      try {
        await handleSave()
      } catch {
        return
      }
    }
    await onMove(task.id, target)
  }

  const addChecklistItem = (): void => {
    const text = checklistDraft.trim()
    if (!text) return
    setChecklist((items) => [...items, { id: `item-${Date.now()}`, text: text.slice(0, 500), completed: false }])
    setChecklistDraft('')
  }

  return createPortal(<div className="hallmark-app portal-root task-detail-overlay fixed inset-0 bg-black/25" onMouseDown={(event) => event.target === event.currentTarget && requestClose()}>
    <aside ref={drawerRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={t('kanban.taskDetails')} className="absolute right-0 top-0 flex h-full w-full max-w-lg flex-col border-l border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900" onMouseDown={(event) => event.stopPropagation()} onKeyDown={(event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault()
        void handleSave().catch(() => undefined)
      }
    }}>
      <header className="flex items-center justify-between border-b border-zinc-200 px-5 py-4 dark:border-zinc-700"><div><p className="text-xs text-zinc-400">{t('kanban.taskDetails')}</p><h2 className="mt-1 text-base font-semibold text-zinc-900 dark:text-zinc-100">{title || task.title}</h2></div><div className="flex items-center gap-2"><span className={`text-[11px] ${isDirty ? 'text-amber-600 dark:text-amber-400' : 'text-zinc-400'}`}>{isDirty ? t('kanban.unsavedChanges') : t('common.saved')}</span><button type="button" onClick={requestClose} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800" aria-label={t('kanban.closeDetails')}><X className="h-4 w-4" /></button></div></header>
      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
        <label className="block text-xs font-medium text-zinc-500">{t('kanban.taskTitle')}<input value={title} onChange={(event) => setTitle(event.target.value)} className="mt-1.5 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 dark:border-zinc-700 dark:bg-zinc-800" /></label>
        <label className="block text-xs font-medium text-zinc-500">{t('kanban.descriptionPlaceholder')}<textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={5} className="mt-1.5 w-full resize-y rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 dark:border-zinc-700 dark:bg-zinc-800" /></label>
        <div className="grid grid-cols-2 gap-3"><label className="block text-xs font-medium text-zinc-500">{t('kanban.priority')}<select value={priority} onChange={(event) => setPriority(event.target.value as TaskPriority)} className="mt-1.5 w-full rounded-lg border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-700 dark:bg-zinc-800"><option value="high">{t('kanban.priorityHigh')}</option><option value="medium">{t('kanban.priorityMedium')}</option><option value="low">{t('kanban.priorityLow')}</option></select></label><label className="block text-xs font-medium text-zinc-500">{t('kanban.dueDate')}<span className="relative mt-1.5 block"><Calendar className="pointer-events-none absolute left-2 top-2 h-4 w-4 text-zinc-400" /><input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} className="w-full rounded-lg border border-zinc-200 bg-white py-2 pl-8 pr-2 text-xs dark:border-zinc-700 dark:bg-zinc-800" /></span></label></div>
        <label className="block text-xs font-medium text-zinc-500">{t('kanban.moveTo')}<select value={task.board_column} onChange={(event) => void handleMove(event.target.value)} disabled={saving} className="mt-1.5 w-full rounded-lg border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-700 dark:bg-zinc-800"><option value="draft">{t('kanban.drafts')}</option>{columns.map((column) => <option key={column.column_key} value={column.column_key}>{columnName(column.column_key)}</option>)}</select></label>
        <label className="block text-xs font-medium text-zinc-500">{t('workspace.project')}<select value={projectId} onChange={(event) => setProjectId(event.target.value)} className="mt-1.5 w-full rounded-lg border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-700 dark:bg-zinc-800"><option value="">{t('workspace.unassigned')}</option>{projects.map((project) => <option key={project.public_id} value={project.public_id}>{project.name}</option>)}</select></label>
        <label className="block text-xs font-medium text-zinc-500">{t('workspace.tags')}<input value={tags} onChange={(event) => setTags(event.target.value)} placeholder={t('workspace.tagsPlaceholder')} className="mt-1.5 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs dark:border-zinc-700 dark:bg-zinc-800" /></label>
        <section className="rounded-xl bg-zinc-50 p-3 dark:bg-zinc-800/60"><div className="flex items-center justify-between text-xs font-medium text-zinc-500"><span>{t('kanban.checklist')}</span><span>{checklist.filter((item) => item.completed).length}/{checklist.length}</span></div><div className="mt-2 space-y-2">{checklist.map((item) => <div key={item.id} className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300"><input type="checkbox" checked={item.completed} onChange={(event) => setChecklist((items) => items.map((current) => current.id === item.id ? { ...current, completed: event.target.checked } : current))} aria-label={item.text} /><span className={item.completed ? 'line-through text-zinc-400' : ''}>{item.text}</span><button type="button" onClick={() => setChecklist((items) => items.filter((current) => current.id !== item.id))} className="ml-auto text-zinc-300 hover:text-red-500" aria-label={t('kanban.removeChecklist')}><Trash2 className="h-3.5 w-3.5" /></button></div>)}</div><div className="mt-3 flex gap-2"><input value={checklistDraft} onChange={(event) => setChecklistDraft(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && addChecklistItem()} placeholder={t('kanban.checklistPlaceholder')} aria-label={t('kanban.checklistPlaceholder')} className="min-w-0 flex-1 rounded border border-zinc-200 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900" /><button type="button" onClick={addChecklistItem} className="rounded bg-white px-2 text-zinc-400 hover:text-blue-500 dark:bg-zinc-900" aria-label={t('kanban.addChecklist')}><Plus className="h-3.5 w-3.5" /></button></div></section>
      </div>
      <footer className="flex items-center justify-between border-t border-zinc-200 px-5 py-4 dark:border-zinc-700"><div className="flex items-center gap-3"><button type="button" onClick={() => void onDelete(task.id)} className="inline-flex items-center gap-1.5 text-xs text-red-500 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" />{t('kanban.deleteTask')}</button>{task.status === 'done' && <button type="button" onClick={() => void onReopen(task.id)} className="text-xs font-medium text-green-600 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300">{t('kanban.cancelComplete')}</button>}</div><div className="flex gap-2"><button type="button" onClick={requestClose} className="rounded-lg px-3 py-2 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">{t('common.cancel')}</button><button type="button" onClick={() => void handleSave().catch(() => undefined)} disabled={saving || !title.trim() || !isDirty} className="ui-button ui-button--primary text-xs"><Check className="h-3.5 w-3.5" />{saving ? t('common.saving') : t('common.save')}</button></div></footer>
    </aside>
  </div>, document.body)
}

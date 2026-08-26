import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  DndContext,
  DragOverlay,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { restrictToWindowEdges } from '@dnd-kit/modifiers'
import { Archive, Calendar, Check, ChevronLeft, ChevronRight, GripVertical, MoreHorizontal, Pencil, Plus, Settings2, Trash2, X } from 'lucide-react'
import { useTaskStore } from '../stores/taskStore'
import { useToast } from '../components/Toast'
import { useI18n } from '../stores/languageStore'
import { useProjectStore } from '../stores/projectStore'
import { useRepositoryStore } from '../stores/repositoryStore'
import { extractHashTags } from '../lib/workspaceInteractions'
import type { WorkItemAssociations } from '../lib/workspaceTypes'
import { WorkspacePageHeader } from '../components/WorkspacePageHeader'
import { WorkspaceSectionTabs } from '../components/WorkspaceSectionTabs'

type TaskPriority = 'low' | 'medium' | 'high'
type TaskStatus = 'todo' | 'in_progress' | 'done' | 'draft'

interface ChecklistItem {
  id: string
  text: string
  completed: boolean
}

interface Task {
  id: number
  public_id: string
  title: string
  description: string
  status: TaskStatus
  board_column: string
  position: number
  due_date: string | null
  priority: TaskPriority
  checklist: ChecklistItem[]
  project_id: string | null
  repository_id: string | null
  tag_names: string[]
}

interface KanbanColumn {
  public_id: string
  column_key: string
  name: string
  status: Exclude<TaskStatus, 'draft'>
  position: number
  is_system: boolean
}

type TaskUpdates = Partial<Pick<Task, 'title' | 'description' | 'status' | 'board_column' | 'position' | 'due_date' | 'priority' | 'checklist'>> & WorkItemAssociations

const SYSTEM_COLUMN_STYLES: Record<string, string> = { todo: 'border-zinc-300', in_progress: 'border-blue-400', done: 'border-green-400' }
const SAVE_SHORTCUT_LABEL = navigator.userAgent.includes('Mac') ? '⌘+Enter' : 'Ctrl+Enter'

function priorityLabel(priority: TaskPriority, t: (key: any, values?: Record<string, string | number>) => string): string {
  if (priority === 'high') return t('kanban.priorityHigh')
  if (priority === 'low') return t('kanban.priorityLow')
  return t('kanban.priorityMedium')
}

function priorityClass(priority: TaskPriority): string {
  if (priority === 'high') return 'bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-300'
  if (priority === 'low') return 'bg-zinc-100 text-zinc-500 dark:bg-zinc-700 dark:text-zinc-300'
  return 'bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-300'
}

function getDueDateStatus(due: string | null): 'normal' | 'soon' | 'overdue' | null {
  if (!due) return null
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  const dueDate = new Date(`${due}T00:00:00`)
  const diff = (dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
  if (diff < 0) return 'overdue'
  if (diff <= 2) return 'soon'
  return 'normal'
}

function formatDue(due: string): string {
  const date = new Date(`${due}T00:00:00`)
  return `${date.getMonth() + 1}/${date.getDate()}`
}

function DroppableColumn({ id, children }: { id: string; children: ReactNode }): JSX.Element {
  const { setNodeRef, isOver } = useDroppable({ id })
  return <div ref={setNodeRef} className={`min-h-[120px] rounded-xl transition-colors ${isOver ? 'bg-zinc-100/80 dark:bg-zinc-800/80' : ''}`}>{children}</div>
}

function DatePickerPortal({ anchorRect, defaultValue, onChange, onClose }: { anchorRect: DOMRect; defaultValue: string; onChange: (value: string) => void; onClose: () => void }): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { requestAnimationFrame(() => inputRef.current?.showPicker?.()) }, [])
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent): void => { if (inputRef.current && !inputRef.current.contains(event.target as Node)) onClose() }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [onClose])
  return createPortal(
    <div className="fixed z-[100]" style={{ top: anchorRect.bottom + 4, left: anchorRect.left }}>
      <input ref={inputRef} type="date" defaultValue={defaultValue} onChange={(event) => { onChange(event.target.value); onClose() }} onBlur={onClose} onKeyDown={(event) => event.key === 'Escape' && onClose()} className="rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-xs shadow-lg outline-none dark:border-zinc-600 dark:bg-zinc-700 dark:text-zinc-200" />
    </div>,
    document.body
  )
}

function Checklist({ task, onUpdate, t }: { task: Task; onUpdate: (id: number, updates: TaskUpdates) => void; t: (key: any, values?: Record<string, string | number>) => string }): JSX.Element {
  const [draft, setDraft] = useState('')
  const [open, setOpen] = useState(task.checklist.length > 0)
  const completed = task.checklist.filter((item) => item.completed).length
  const updateItem = (itemId: string, updates: Partial<ChecklistItem>): void => onUpdate(task.id, { checklist: task.checklist.map((item) => item.id === itemId ? { ...item, ...updates } : item) })
  const addItem = (): void => {
    const text = draft.trim()
    if (!text) return
    onUpdate(task.id, { checklist: [...task.checklist, { id: `item-${Date.now()}`, text: text.slice(0, 500), completed: false }] })
    setDraft('')
  }
  if (!open) {
    return <button type="button" onClick={() => setOpen(true)} className="mt-2 flex items-center gap-1 text-[11px] text-zinc-400 hover:text-blue-500"><Plus className="h-3 w-3" />{t('kanban.checklist')}</button>
  }

  return (
    <div className="mt-2 rounded-lg bg-zinc-50 px-2.5 py-2 dark:bg-zinc-900/60">
      <div className="mb-1.5 flex items-center justify-between gap-2 text-[11px] text-zinc-500"><span>{t('kanban.checklist')}</span><span>{t('kanban.checklistProgress', { completed, total: task.checklist.length })}</span></div>
      <div className="space-y-1">{task.checklist.map((item) => <label key={item.id} className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300"><input type="checkbox" checked={item.completed} onChange={(event) => updateItem(item.id, { completed: event.target.checked })} /><span className={item.completed ? 'text-zinc-400 line-through' : ''}>{item.text}</span></label>)}</div>
      <div className="mt-2 flex gap-1"><input value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addItem() } }} placeholder={t('kanban.checklistPlaceholder')} className="min-w-0 flex-1 rounded border border-zinc-200 bg-white px-2 py-1 text-xs outline-none focus:border-blue-400 dark:border-zinc-700 dark:bg-zinc-800" /><button type="button" onClick={addItem} className="rounded px-2 text-zinc-400 hover:bg-white hover:text-blue-500 dark:hover:bg-zinc-800" aria-label={t('kanban.addColumn')}><Plus className="h-3.5 w-3.5" /></button></div>
    </div>
  )
}

function SortableTaskCard({ task, columns, onDelete, onSetDue, onUpdate, onMove, projects, repositories, columnName }: { task: Task; columns: KanbanColumn[]; onDelete: (id: number) => void; onSetDue?: (id: number, date: string | null) => void; onUpdate: (id: number, updates: TaskUpdates) => void; onMove: (id: number, columnKey: string) => void; projects: { public_id: string; name: string }[]; repositories: { public_id: string; name: string }[]; columnName: (columnKey: string) => string }): JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id })
  const { t } = useI18n()
  const [pickerRect, setPickerRect] = useState<DOMRect | null>(null)
  const [editing, setEditing] = useState(false)
  const [editTitle, setEditTitle] = useState(task.title)
  const [editDesc, setEditDesc] = useState(task.description)
  const [editProjectId, setEditProjectId] = useState(task.project_id ?? '')
  const [editRepositoryId, setEditRepositoryId] = useState(task.repository_id ?? '')
  const [editTags, setEditTags] = useState(task.tag_names.map((tag) => `#${tag}`).join(' '))
  const [editPriority, setEditPriority] = useState<TaskPriority>(task.priority)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }
  const dueStatus = getDueDateStatus(task.due_date)
  const dueColor = dueStatus === 'overdue' ? 'text-red-500' : dueStatus === 'soon' ? 'text-amber-500' : 'text-zinc-400'
  const currentColumn = task.board_column || task.status

  const startEdit = useCallback(() => {
    setEditTitle(task.title)
    setEditDesc(task.description)
    setEditProjectId(task.project_id ?? '')
    setEditRepositoryId(task.repository_id ?? '')
    setEditTags(task.tag_names.map((tag) => `#${tag}`).join(' '))
    setEditPriority(task.priority)
    setEditing(true)
    requestAnimationFrame(() => titleInputRef.current?.focus())
  }, [task])
  const saveEdit = useCallback(() => {
    const title = editTitle.trim()
    if (!title) return
    const updates: TaskUpdates = { project_id: editProjectId || null, repository_id: editRepositoryId || null, tag_names: extractHashTags(editTags).tags, priority: editPriority }
    if (title !== task.title) updates.title = title
    if (editDesc.trim() !== task.description) updates.description = editDesc.trim()
    onUpdate(task.id, updates)
    setEditing(false)
  }, [editDesc, editPriority, editProjectId, editRepositoryId, editTags, editTitle, onUpdate, task])
  const cancelEdit = useCallback(() => setEditing(false), [])
  const handleEditKeyDown = useCallback((event: React.KeyboardEvent) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) saveEdit(); if (event.key === 'Escape') cancelEdit() }, [cancelEdit, saveEdit])
  const openPicker = (event: React.MouseEvent): void => setPickerRect((event.currentTarget as HTMLElement).getBoundingClientRect())

  return (
    <div ref={setNodeRef} id={`task-card-${task.public_id}`} style={style} tabIndex={-1} className="group rounded-xl border border-zinc-200 bg-white p-3 shadow-sm transition-all hover:shadow-md dark:border-zinc-700 dark:bg-zinc-800">
      <div className="flex items-start gap-2">
        <button {...attributes} {...listeners} className="mt-0.5 shrink-0 cursor-grab p-0.5 text-zinc-300 hover:text-zinc-500 active:cursor-grabbing" aria-label={t('kanban.dragTask')}><GripVertical className="h-4 w-4" /></button>
        <div className="min-w-0 flex-1" onDoubleClick={() => !editing && startEdit()}>
          {editing ? (
            <div className="space-y-1.5" onKeyDown={handleEditKeyDown}>
              <input ref={titleInputRef} value={editTitle} onChange={(event) => setEditTitle(event.target.value)} placeholder={t('kanban.taskTitle')} className="w-full rounded border border-zinc-300 bg-white px-2 py-1 text-sm outline-none focus:border-blue-400 dark:border-zinc-600 dark:bg-zinc-700" />
              <textarea value={editDesc} onChange={(event) => setEditDesc(event.target.value)} placeholder={t('kanban.descriptionPlaceholder')} rows={2} className="w-full resize-none rounded border border-zinc-300 bg-white px-2 py-1 text-xs outline-none focus:border-blue-400 dark:border-zinc-600 dark:bg-zinc-700" />
              <div className="grid grid-cols-2 gap-1.5">
                <select value={editPriority} onChange={(event) => setEditPriority(event.target.value as TaskPriority)} aria-label={t('kanban.priority')} className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-700"><option value="high">{t('kanban.priorityHigh')}</option><option value="medium">{t('kanban.priorityMedium')}</option><option value="low">{t('kanban.priorityLow')}</option></select>
                <select value={editProjectId} onChange={(event) => setEditProjectId(event.target.value)} aria-label={t('workspace.project')} className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-700"><option value="">{t('workspace.unassigned')}</option>{projects.map((project) => <option key={project.public_id} value={project.public_id}>{project.name}</option>)}</select>
              </div>
              <select value={editRepositoryId} onChange={(event) => setEditRepositoryId(event.target.value)} aria-label={t('workspace.repository')} className="w-full rounded border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-700"><option value="">{t('workspace.unassigned')}</option>{repositories.map((repository) => <option key={repository.public_id} value={repository.public_id}>{repository.name}</option>)}</select>
              <input value={editTags} onChange={(event) => setEditTags(event.target.value)} placeholder={t('workspace.tagsPlaceholder')} aria-label={t('workspace.tags')} className="w-full rounded border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-700" />
              <div className="flex items-center gap-1"><button type="button" onClick={saveEdit} className="p-1 text-green-500 hover:text-green-600" aria-label={t('kanban.saveEdit')} title={t('kanban.saveShortcut', { shortcut: SAVE_SHORTCUT_LABEL })}><Check className="h-3.5 w-3.5" /></button><button type="button" onClick={cancelEdit} className="p-1 text-zinc-400 hover:text-zinc-600" aria-label={t('kanban.cancelEdit')}><X className="h-3.5 w-3.5" /></button></div>
            </div>
          ) : (
            <>
              <div className="flex items-start justify-between gap-2"><p className="break-words text-sm text-zinc-800 dark:text-zinc-200">{task.title}</p><span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${priorityClass(task.priority)}`}>{priorityLabel(task.priority, t)}</span></div>
              {task.description && <p className="mt-1 break-words text-xs text-zinc-400">{task.description}</p>}
            </>
          )}
          {!editing && <>
            <Checklist task={task} onUpdate={onUpdate} t={t} />
            {onSetDue && <div className="mt-1 flex items-center gap-2">{task.due_date ? <button type="button" onClick={openPicker} className={`flex items-center gap-1 text-xs ${dueColor}`} title={t('kanban.dueTitle', { date: task.due_date })}><Calendar className="h-3 w-3" />{formatDue(task.due_date)}</button> : <button type="button" onClick={openPicker} className="flex items-center gap-1 text-xs text-zinc-300 opacity-0 transition-all hover:text-zinc-500 group-hover:opacity-100 focus-visible:opacity-100" aria-label={t('kanban.due')}><Calendar className="h-3 w-3" />{t('kanban.due')}</button>}{pickerRect && <DatePickerPortal anchorRect={pickerRect} defaultValue={task.due_date || ''} onChange={(value) => onSetDue(task.id, value || null)} onClose={() => setPickerRect(null)} />}</div>}
            <label className="kanban-move-control mt-2 block"><span>{t('kanban.moveTo')}</span><select value="" onChange={(event) => event.target.value && onMove(task.id, event.target.value)} className="mt-1 w-full text-xs"><option value="">{columnName(currentColumn)}</option>{columns.filter((column) => column.column_key !== currentColumn).map((column) => <option key={column.column_key} value={column.column_key}>{column.name}</option>)}{currentColumn !== 'draft' && <option value="draft">{t('kanban.drafts')}</option>}</select></label>
          </>}
        </div>
        {!editing && <div className="flex shrink-0 items-center gap-0.5"><button type="button" onClick={startEdit} className="p-1 text-zinc-300 transition-all hover:text-blue-500" aria-label={t('kanban.editTask')}><Pencil className="h-3.5 w-3.5" /></button><button type="button" onClick={() => onDelete(task.id)} className="p-1 text-zinc-300 opacity-0 transition-all hover:text-red-500 group-hover:opacity-100 focus-visible:opacity-100" aria-label={t('kanban.deleteTask')}><Trash2 className="h-3.5 w-3.5" /></button></div>}
      </div>
    </div>
  )
}

function TaskCardOverlay({ task }: { task: Task }): JSX.Element { return <div className="rounded-xl border border-zinc-300 bg-white p-3 shadow-lg dark:border-zinc-600 dark:bg-zinc-800"><p className="text-sm text-zinc-800 dark:text-zinc-200">{task.title}</p></div> }

function CompleteDialog({ task, onConfirm, onCancel, onOnlyComplete }: { task: Task; onConfirm: (content: string) => void; onCancel: () => void; onOnlyComplete: () => void }): JSX.Element {
  const { t } = useI18n()
  const [content, setContent] = useState(() => t('kanban.completeLogDefault', { title: task.title }))
  const inputRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select() }, [])
  return createPortal(<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"><div className="mx-4 w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:bg-zinc-900"><h3 className="mb-1 text-base font-semibold text-zinc-900 dark:text-zinc-100">{t('kanban.completeTitle')}</h3><p className="mb-4 text-sm text-zinc-500">{t('kanban.completePrompt')}</p><textarea ref={inputRef} value={content} onChange={(event) => setContent(event.target.value)} rows={3} className="mb-4 w-full resize-none rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-600 dark:bg-zinc-800" /><div className="flex justify-end gap-2"><button type="button" onClick={onCancel} className="px-3 py-2 text-sm text-zinc-500 hover:text-zinc-700">{t('common.skip')}</button><button type="button" onClick={() => onConfirm(content)} className="rounded-lg bg-zinc-900 px-3 py-2 text-sm text-white hover:bg-zinc-800">{t('kanban.completeSubmit')}</button><button type="button" onClick={onOnlyComplete} className="rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-700 dark:border-zinc-600 dark:text-zinc-300">{t('kanban.completeOnly')}</button></div></div></div>, document.body)
}

function KanbanPage({ focusPublicId }: { focusPublicId?: string | null }): JSX.Element {
  const { tasks, fetchTasks, loadByPublicId, addTask, updateTask, deleteTask, completeTask, completeTaskOnly, reorderTasks } = useTaskStore()
  const toast = useToast()
  const { t } = useI18n()
  const projects = useProjectStore((state) => state.items)
  const fetchProjects = useProjectStore((state) => state.fetch)
  const repositories = useRepositoryStore((state) => state.items)
  const fetchRepositories = useRepositoryStore((state) => state.fetch)
  const [columns, setColumns] = useState<KanbanColumn[]>([])
  const [newColumnName, setNewColumnName] = useState('')
  const [editingColumnId, setEditingColumnId] = useState<string | null>(null)
  const [editingColumnName, setEditingColumnName] = useState('')
  const [columnsOpen, setColumnsOpen] = useState(false)
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [newTaskDesc, setNewTaskDesc] = useState('')
  const [newTaskDate, setNewTaskDate] = useState('')
  const [newTaskPriority, setNewTaskPriority] = useState<TaskPriority>('medium')
  const [newProjectId, setNewProjectId] = useState('')
  const [newRepositoryId, setNewRepositoryId] = useState('')
  const [newTags, setNewTags] = useState('')
  const [showDescInput, setShowDescInput] = useState(false)
  const [draftInput, setDraftInput] = useState('')
  const [activeTask, setActiveTask] = useState<Task | null>(null)
  const [pendingComplete, setPendingComplete] = useState<Task | null>(null)
  const [localTasks, setLocalTasks] = useState<Task[]>([])
  const [draftOpen, setDraftOpen] = useState(() => localStorage.getItem('kanban:draftOpen') !== 'false')

  const fetchColumns = useCallback(async (): Promise<void> => setColumns(await window.api.kanban.columns.list()), [])
  useEffect(() => { void fetchTasks(); void fetchProjects(); void fetchRepositories(); void fetchColumns() }, [fetchColumns, fetchProjects, fetchRepositories, fetchTasks])
  useEffect(() => setLocalTasks(tasks as Task[]), [tasks])
  useEffect(() => {
    if (!focusPublicId) return
    void loadByPublicId(focusPublicId).then((task) => { if (task) requestAnimationFrame(() => document.getElementById(`task-card-${focusPublicId}`)?.scrollIntoView({ block: 'center' })) })
  }, [focusPublicId, loadByPublicId])

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const columnByKey = useMemo(() => new Map(columns.map((column) => [column.column_key, column])), [columns])
  const getColumnTasks = useCallback((columnKey: string): Task[] => localTasks.filter((task) => task.board_column === columnKey).sort((a, b) => a.position - b.position), [localTasks])
  const draftTasks = useMemo(() => getColumnTasks('draft'), [getColumnTasks])
  const boardGridStyle = { gridTemplateColumns: `repeat(${Math.max(columns.length, 1)}, minmax(220px, 1fr))` }
  const columnName = useCallback((columnKey: string): string => {
    if (columnKey === 'draft') return t('kanban.drafts')
    const column = columnByKey.get(columnKey)
    if (column) return column.name
    if (columnKey === 'todo') return t('kanban.todo')
    if (columnKey === 'in_progress') return t('kanban.inProgress')
    if (columnKey === 'done') return t('kanban.done')
    return columnKey
  }, [columnByKey, t])
  const targetStatus = (columnKey: string): TaskStatus => columnByKey.get(columnKey)?.status ?? (columnKey === 'draft' ? 'draft' : 'todo')
  const findTaskColumn = (taskId: number | string): string | null => localTasks.find((task) => task.id === taskId)?.board_column ?? null
  const getOverColumn = (overId: string | number): string | null => overId === 'draft' || columnByKey.has(String(overId)) ? String(overId) : findTaskColumn(overId)

  const handleAddTask = async (): Promise<void> => {
    if (!newTaskTitle.trim()) return
    const createdAt = newTaskDate ? `${newTaskDate} ${new Date().toTimeString().slice(0, 8)}` : undefined
    await addTask(newTaskTitle.trim(), newTaskDesc.trim() || undefined, undefined, createdAt, { project_id: newProjectId || null, repository_id: newRepositoryId || null, tag_names: extractHashTags(newTags).tags }, newTaskPriority)
    setNewTaskTitle(''); setNewTaskDesc(''); setNewTaskDate(''); setNewTaskPriority('medium'); setNewProjectId(''); setNewRepositoryId(''); setNewTags(''); setShowDescInput(false)
  }
  const handleAddDraft = async (): Promise<void> => { if (!draftInput.trim()) return; await addTask(draftInput.trim(), undefined, 'draft'); setDraftInput('') }
  const handleDragStart = (event: DragStartEvent): void => setActiveTask(localTasks.find((task) => task.id === event.active.id) ?? null)
  const handleDragOver = (event: DragOverEvent): void => {
    if (!event.over) return
    const target = getOverColumn(event.over.id)
    const activeId = event.active.id as number
    const active = localTasks.find((task) => task.id === activeId)
    if (!target || !active || active.board_column === target) return
    setLocalTasks((current) => current.map((task) => task.id === activeId ? { ...task, board_column: target, status: targetStatus(target) } : task))
  }
  const handleDragEnd = async (event: DragEndEvent): Promise<void> => {
    setActiveTask(null)
    if (!event.over) { setLocalTasks(tasks as Task[]); return }
    const activeId = event.active.id as number
    const active = localTasks.find((task) => task.id === activeId)
    const target = getOverColumn(event.over.id)
    if (!active || !target) return
    const original = tasks.find((task) => task.id === activeId) as Task | undefined
    const status = targetStatus(target)
    if (status === 'done' && original?.status !== 'done') { setPendingComplete({ ...active, board_column: target, status: 'done' }); return }
    const columnTasks = getColumnTasks(target)
    const oldIndex = columnTasks.findIndex((task) => task.id === activeId)
    const overIndex = columnTasks.findIndex((task) => task.id === event.over?.id)
    const ordered = oldIndex !== -1 && overIndex !== -1 && oldIndex !== overIndex ? arrayMove(columnTasks, oldIndex, overIndex) : columnTasks
    await reorderTasks(ordered.map((task) => task.id), target, status)
  }
  const handleUpdate = async (id: number, updates: TaskUpdates): Promise<void> => { await updateTask(id, updates) }
  const handleMove = async (id: number, target: string): Promise<void> => {
    const task = tasks.find((item) => item.id === id) as Task | undefined
    if (!task || task.board_column === target) return
    const status = targetStatus(target)
    if (status === 'done' && task.status !== 'done') { setPendingComplete({ ...task, board_column: target, status: 'done' }); return }
    const destination = tasks.filter((item) => (item as Task).board_column === target && item.id !== id) as Task[]
    await reorderTasks([...destination.map((item) => item.id), id], target, status)
  }
  const handleSetDue = async (id: number, date: string | null): Promise<void> => updateTask(id, { due_date: date })
  const handleDelete = async (id: number): Promise<void> => deleteTask(id)
  const handleComplete = async (content: string): Promise<void> => { if (!pendingComplete) return; await completeTask(pendingComplete.id, content); setPendingComplete(null); toast.success(t('kanban.completedToast')) }
  const handleCompleteOnly = async (): Promise<void> => { if (!pendingComplete) return; await completeTaskOnly(pendingComplete.id); setPendingComplete(null); toast.success(t('kanban.completedOnlyToast')) }
  const handleCancelComplete = async (): Promise<void> => { setPendingComplete(null); await fetchTasks() }
  const createColumn = async (): Promise<void> => { if (!newColumnName.trim()) return; await window.api.kanban.columns.create(newColumnName.trim()); setNewColumnName(''); await fetchColumns() }
  const renameColumn = async (column: KanbanColumn): Promise<void> => { if (!editingColumnName.trim()) return; await window.api.kanban.columns.update(column.public_id, editingColumnName.trim()); setEditingColumnId(null); await fetchColumns() }
  const removeColumn = async (column: KanbanColumn): Promise<void> => { if (!window.confirm(t('kanban.deleteColumnConfirm', { name: column.name }))) return; await window.api.kanban.columns.delete(column.public_id); await Promise.all([fetchColumns(), fetchTasks()]) }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} modifiers={[restrictToWindowEdges]} onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={handleDragEnd}>
      <div className="workspace-page kanban-page">
        <WorkspacePageHeader ariaLabel={t('workspace.breadcrumbLabel')} items={[{ label: t('nav.kanban'), current: true }]} title={t('nav.kanban')} />
        <WorkspaceSectionTabs ariaLabel={t('workspace.sectionNavigation')} items={[{ id: 'board', label: t('nav.kanban'), active: true }, { id: 'drafts', label: t('kanban.drafts'), onClick: () => document.querySelector<HTMLElement>('.kanban-drafts')?.scrollIntoView({ block: 'nearest' }) }]} />
        <div className="kanban-layout flex gap-4">
          <div className="min-w-0 flex-1">
            <div className="mb-6 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-900/60">
              <div className="flex gap-2"><input type="text" value={newTaskTitle} onChange={(event) => setNewTaskTitle(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && !event.shiftKey && void handleAddTask()} onFocus={() => setShowDescInput(true)} placeholder={t('kanban.newTask')} className="min-w-0 flex-1 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm outline-none focus:border-blue-400 dark:border-zinc-700 dark:bg-zinc-800" /><button type="button" onClick={() => void handleAddTask()} className="flex items-center gap-1 rounded-xl bg-zinc-900 px-4 py-2 text-sm text-white transition hover:bg-zinc-800"><Plus className="h-4 w-4" />{t('common.add')}</button></div>
              {showDescInput && <div className="mt-2 flex flex-wrap gap-2"><input type="text" value={newTaskDesc} onChange={(event) => setNewTaskDesc(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && void handleAddTask()} placeholder={t('kanban.newDescription')} className="min-w-[220px] flex-1 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs outline-none focus:border-blue-400 dark:border-zinc-700 dark:bg-zinc-800" /><select value={newTaskPriority} onChange={(event) => setNewTaskPriority(event.target.value as TaskPriority)} aria-label={t('kanban.priority')} className="rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-800"><option value="high">{t('kanban.priorityHigh')}</option><option value="medium">{t('kanban.priorityMedium')}</option><option value="low">{t('kanban.priorityLow')}</option></select><select value={newProjectId} onChange={(event) => setNewProjectId(event.target.value)} aria-label={t('workspace.project')} className="rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-800"><option value="">{t('workspace.unassigned')}</option>{projects.map((project) => <option key={project.public_id} value={project.public_id}>{project.name}</option>)}</select><select value={newRepositoryId} onChange={(event) => setNewRepositoryId(event.target.value)} aria-label={t('workspace.repository')} className="rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-800"><option value="">{t('workspace.unassigned')}</option>{repositories.map((repository) => <option key={repository.public_id} value={repository.public_id}>{repository.name}</option>)}</select><input type="text" value={newTags} onChange={(event) => setNewTags(event.target.value)} placeholder={t('workspace.tagsPlaceholder')} aria-label={t('workspace.tags')} className="rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-800" /><input type="date" value={newTaskDate} onChange={(event) => setNewTaskDate(event.target.value)} className="rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-800" /></div>}
            </div>
            <div className="mb-4 flex items-center justify-between"><div><h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">{t('kanban.manageColumns')}</h2><p className="mt-1 text-xs text-zinc-400">{columns.length} {t('kanban.columnName')}</p></div><button type="button" onClick={() => setColumnsOpen((open) => !open)} className="flex items-center gap-1 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs text-zinc-500 hover:border-blue-300 hover:text-blue-500 dark:border-zinc-700"><Settings2 className="h-3.5 w-3.5" />{t('kanban.manageColumns')}</button></div>
            {columnsOpen && <div className="mb-4 rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-900/60"><div className="flex gap-2"><input value={newColumnName} onChange={(event) => setNewColumnName(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && void createColumn()} placeholder={t('kanban.columnNamePlaceholder')} aria-label={t('kanban.columnName')} className="min-w-0 flex-1 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-blue-400 dark:border-zinc-700 dark:bg-zinc-800" /><button type="button" onClick={() => void createColumn()} className="flex items-center gap-1 rounded-lg bg-zinc-900 px-3 py-1.5 text-xs text-white"><Plus className="h-3.5 w-3.5" />{t('kanban.addColumn')}</button></div><div className="mt-3 space-y-1.5">{columns.map((column) => <div key={column.public_id} className="flex items-center gap-2 rounded-lg bg-white px-2.5 py-2 text-xs dark:bg-zinc-800"><span className="min-w-0 flex-1 truncate">{column.name}</span>{column.is_system ? <span className="text-zinc-400">{t('kanban.priority')}</span> : editingColumnId === column.public_id ? <><input autoFocus value={editingColumnName} onChange={(event) => setEditingColumnName(event.target.value)} className="min-w-0 flex-1 rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-700" /><button type="button" onClick={() => void renameColumn(column)} className="text-green-500" aria-label={t('kanban.saveEdit')}><Check className="h-3.5 w-3.5" /></button><button type="button" onClick={() => setEditingColumnId(null)} className="text-zinc-400" aria-label={t('kanban.cancelEdit')}><X className="h-3.5 w-3.5" /></button></> : <><button type="button" onClick={() => { setEditingColumnId(column.public_id); setEditingColumnName(column.name) }} className="text-zinc-400 hover:text-blue-500" aria-label={t('kanban.renameColumn')}><Pencil className="h-3.5 w-3.5" /></button><button type="button" onClick={() => void removeColumn(column)} className="text-zinc-400 hover:text-red-500" aria-label={t('kanban.deleteColumn')}><Trash2 className="h-3.5 w-3.5" /></button></>}</div>)}</div></div>}
            <div className="kanban-columns grid gap-4 overflow-x-auto pb-3" style={{ gridTemplateColumns: `repeat(${Math.max(columns.length, 1)}, minmax(220px, 1fr))` }}>
              {columns.map((column) => { const columnTasks = getColumnTasks(column.column_key); return <div key={column.column_key} className="min-w-0"><div className={`mb-3 flex items-center gap-2 border-b-2 pb-2 ${SYSTEM_COLUMN_STYLES[column.column_key] ?? 'border-violet-400'}`}><h3 className="truncate text-sm font-medium text-zinc-700 dark:text-zinc-300">{column.name}</h3><span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-400 dark:bg-zinc-800">{columnTasks.length}</span><MoreHorizontal className="ml-auto h-4 w-4 text-zinc-300" /></div><SortableContext items={columnTasks.map((task) => task.id)} strategy={verticalListSortingStrategy}><DroppableColumn id={column.column_key}><div className="space-y-2">{columnTasks.map((task) => <SortableTaskCard key={task.id} task={task} columns={columns} onDelete={handleDelete} onSetDue={handleSetDue} onUpdate={handleUpdate} onMove={handleMove} projects={projects} repositories={repositories} columnName={columnName} />)}{columnTasks.length === 0 && <div className="py-8 text-center text-xs text-zinc-300">{t('kanban.dropHere')}</div>}</div></DroppableColumn></SortableContext></div> })}
            </div>
          </div>
          <div className={`kanban-drafts flex shrink-0 flex-col rounded-xl border-l border-zinc-200 bg-zinc-50/50 transition-all dark:border-zinc-700 dark:bg-zinc-900/50 ${draftOpen ? 'w-60' : 'w-10'}`}>
            <button type="button" onClick={() => { const next = !draftOpen; setDraftOpen(next); localStorage.setItem('kanban:draftOpen', String(next)) }} className="flex h-10 shrink-0 items-center justify-center rounded-t-xl border-b border-zinc-200 text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800" aria-label={draftOpen ? t('kanban.collapseDrafts') : t('kanban.expandDrafts')}>{draftOpen ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}</button>
            {!draftOpen && <div className="flex flex-col items-center gap-1 pt-3"><Archive className="h-4 w-4 text-zinc-400" /><span className="text-xs text-zinc-400" style={{ writingMode: 'vertical-rl' }}>{t('kanban.draftsCollapsed', { count: draftTasks.length })}</span></div>}
            {draftOpen && <div className="kanban-drafts-content flex flex-1 flex-col"><div className="flex items-center gap-2 border-b border-zinc-200 px-3 py-3 dark:border-zinc-700"><Archive className="h-4 w-4 text-zinc-400" /><h3 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('kanban.drafts')}</h3><span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-400 dark:bg-zinc-800">{draftTasks.length}</span></div><p className="px-3 py-2 text-xs text-zinc-400">{t('kanban.draftHelp')}</p><div className="px-3 pb-3"><div className="flex gap-1"><input value={draftInput} onChange={(event) => setDraftInput(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && void handleAddDraft()} placeholder={t('kanban.draftPlaceholder')} className="min-w-0 flex-1 rounded border border-zinc-200 bg-white px-2 py-1.5 text-xs outline-none focus:border-blue-400 dark:border-zinc-600 dark:bg-zinc-800" /><button type="button" onClick={() => void handleAddDraft()} className="rounded bg-zinc-100 px-2 py-1.5 text-zinc-600 hover:bg-zinc-200" aria-label={t('kanban.addDraft')}><Plus className="h-3 w-3" /></button></div></div><SortableContext items={draftTasks.map((task) => task.id)} strategy={verticalListSortingStrategy}><DroppableColumn id="draft"><div className="flex-1 space-y-1.5 overflow-y-auto px-3 pb-3">{draftTasks.map((task) => <SortableTaskCard key={task.id} task={task} columns={columns} onDelete={handleDelete} onUpdate={handleUpdate} onMove={handleMove} projects={projects} repositories={repositories} columnName={columnName} />)}{draftTasks.length === 0 && <div className="py-6 text-center text-xs text-zinc-300">{t('kanban.noDrafts')}</div>}</div></DroppableColumn></SortableContext></div>}
          </div>
        </div>
      </div>
      <DragOverlay>{activeTask ? <TaskCardOverlay task={activeTask} /> : null}</DragOverlay>
      {pendingComplete && <CompleteDialog task={pendingComplete} onConfirm={handleComplete} onCancel={() => void handleCancelComplete()} onOnlyComplete={() => void handleCompleteOnly()} />}
    </DndContext>
  )
}

export default KanbanPage

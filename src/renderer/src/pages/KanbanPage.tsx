import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { Archive, Check, ChevronLeft, ChevronRight, Plus, Search, Settings2, Trash2, X } from 'lucide-react'
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent
} from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { restrictToWindowEdges } from '@dnd-kit/modifiers'
import { useTaskStore } from '../stores/taskStore'
import { useToast } from '../components/Toast'
import { useI18n } from '../stores/languageStore'
import { useProjectStore } from '../stores/projectStore'
import { buildReopenTaskMove, filterAndSortTasks, type KanbanDueFilter, type KanbanSort } from '../lib/kanbanBoard'
import type { KanbanColumn, KanbanTask, TaskPriority, TaskStatus, TaskUpdates } from '../lib/kanbanTypes'
import { WorkspacePageHeader } from '../components/WorkspacePageHeader'
import { WorkspaceSectionTabs } from '../components/WorkspaceSectionTabs'
import { KanbanTaskCard, TaskCardOverlay } from '../components/KanbanTaskCard'
import { TaskDetailDrawer } from '../components/TaskDetailDrawer'

const SYSTEM_COLUMN_STYLES: Record<string, string> = { todo: 'kanban-column-border--todo', in_progress: 'kanban-column-border--progress', done: 'kanban-column-border--done' }

interface PendingComplete {
  task: KanbanTask
  target: string
  orderedIds: number[]
  sourceColumn?: string
  sourceTaskIds: number[]
  sourceStatus?: TaskStatus
}

function DroppableColumn({ id, children }: { id: string; children: React.ReactNode }): JSX.Element {
  const { setNodeRef, isOver } = useDroppable({ id })
  return <div ref={setNodeRef} className={`min-h-[120px] rounded-xl transition-colors ${isOver ? 'bg-zinc-100/80 dark:bg-zinc-800/80' : ''}`}>{children}</div>
}

function CompleteDialog({ task, onConfirm, onCancel, onOnlyComplete }: { task: KanbanTask; onConfirm: (content: string) => void; onCancel: () => void; onOnlyComplete: () => void }): JSX.Element {
  const { t } = useI18n()
  const [content, setContent] = useState(() => t('kanban.completeLogDefault', { title: task.title }))
  const dialogRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef(onCancel)
  cancelRef.current = onCancel
  useEffect(() => {
    dialogRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancelRef.current() }
      if (event.key !== 'Tab') return
      const dialog = dialogRef.current
      if (!dialog) return
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [href]'))
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [])
  return createPortal(
    <div className="hallmark-app portal-root fixed inset-0 z-50 flex items-center justify-center bg-black/40" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onCancel()}>
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="complete-task-title" className="mx-4 w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:bg-zinc-900">
        <h3 id="complete-task-title" className="mb-1 text-base font-semibold text-zinc-900 dark:text-zinc-100">{t('kanban.completeTitle')}</h3>
        <p className="mb-4 text-sm text-zinc-500">{t('kanban.completePrompt')}</p>
        <textarea autoFocus value={content} onChange={(event) => setContent(event.target.value)} rows={3} aria-label={t('kanban.completePrompt')} className="mb-4 w-full resize-y rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-600 dark:bg-zinc-800" />
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onCancel} className="ui-button ui-button--ghost">{t('common.cancel')}</button>
          <button type="button" onClick={() => onConfirm(content)} className="ui-button ui-button--primary">{t('kanban.completeSubmit')}</button>
          <button type="button" onClick={onOnlyComplete} className="ui-button ui-button--secondary">{t('kanban.completeOnly')}</button>
        </div>
      </div>
    </div>,
    document.body
  )
}

function KanbanPage({ focusPublicId, onFocusHandled }: { focusPublicId?: string | null; onFocusHandled?: () => void }): JSX.Element {
  const { tasks, loading, error, fetchTasks, loadByPublicId, addTask, updateTask, deleteTask, undoDelete, completeTask, completeTaskOnly, reorderTasks } = useTaskStore()
  const toast = useToast()
  const { t } = useI18n()
  const projects = useProjectStore((state) => state.items)
  const fetchProjects = useProjectStore((state) => state.fetch)
  const [columns, setColumns] = useState<KanbanColumn[]>([])
  const [newColumnName, setNewColumnName] = useState('')
  const [editingColumnId, setEditingColumnId] = useState<string | null>(null)
  const [editingColumnName, setEditingColumnName] = useState('')
  const [columnsOpen, setColumnsOpen] = useState(false)
  const [draftInput, setDraftInput] = useState('')
  const [activeTask, setActiveTask] = useState<KanbanTask | null>(null)
  const [draggingTask, setDraggingTask] = useState<KanbanTask | null>(null)
  const [pendingComplete, setPendingComplete] = useState<PendingComplete | null>(null)
  const [localTasks, setLocalTasks] = useState<KanbanTask[]>([])
  const isDraggingRef = useRef(false)
  const dragRefreshPendingRef = useRef(false)
  const [query, setQuery] = useState('')
  const [showDone, setShowDone] = useState(true)
  const [projectFilter, setProjectFilter] = useState('')
  const [priorityFilter, setPriorityFilter] = useState<TaskPriority | 'all'>('all')
  const [dueFilter, setDueFilter] = useState<KanbanDueFilter>('all')
  const [sort, setSort] = useState<KanbanSort>('manual')
  const [draftOpen, setDraftOpen] = useState(() => localStorage.getItem('kanban:draftOpen') !== 'false')

  const fetchColumns = useCallback(async (): Promise<void> => setColumns(await window.api.kanban.columns.list()), [])
  useEffect(() => { void fetchTasks(); void fetchProjects(); void fetchColumns() }, [fetchColumns, fetchProjects, fetchTasks])
  useEffect(() => window.api.on.taskCreateChanged(() => { void fetchTasks(); toast.success(t('kanban.taskCreated')) }), [fetchTasks, t, toast])
  useEffect(() => {
    if (isDraggingRef.current) {
      dragRefreshPendingRef.current = true
      return
    }
    setLocalTasks(tasks as KanbanTask[])
  }, [tasks])
  useEffect(() => {
    if (!focusPublicId) return
    void loadByPublicId(focusPublicId).then((task) => { if (task) requestAnimationFrame(() => { document.getElementById(`task-card-${focusPublicId}`)?.scrollIntoView({ block: 'center' }); onFocusHandled?.() }) }).finally(() => { if (!useTaskStore.getState().tasks.some((task) => task.public_id === focusPublicId)) onFocusHandled?.() })
  }, [focusPublicId, loadByPublicId, onFocusHandled])

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  const columnByKey = useMemo(() => new Map(columns.map((column) => [column.column_key, column])), [columns])
  const hasBoardFilters = Boolean(query.trim() || !showDone || projectFilter || priorityFilter !== 'all' || dueFilter !== 'all' || sort !== 'manual')
  const boardTasks = useMemo(() => filterAndSortTasks(localTasks.filter((task) => task.board_column !== 'draft'), { query, showDone, projectId: projectFilter || undefined, priority: priorityFilter, due: dueFilter, sort }), [dueFilter, localTasks, priorityFilter, projectFilter, query, showDone, sort])
  const draftTasks = useMemo(() => filterAndSortTasks(localTasks.filter((task) => task.board_column === 'draft'), { query, showDone: true, sort: 'manual' }), [localTasks, query])
  const getColumnTasks = useCallback((columnKey: string): KanbanTask[] => boardTasks.filter((task) => task.board_column === columnKey), [boardTasks])
  const boardGridStyle = { '--kanban-column-count': Math.max(columns.length, 1) } as CSSProperties
  const columnName = useCallback((columnKey: string): string => {
    if (columnKey === 'draft') return t('kanban.drafts')
    const column = columnByKey.get(columnKey)
    if (column) return column.name
    if (columnKey === 'todo') return t('kanban.todo')
    if (columnKey === 'in_progress') return t('kanban.inProgress')
    if (columnKey === 'done') return t('kanban.done')
    return columnKey
  }, [columnByKey, t])
  const targetStatus = useCallback((columnKey: string): TaskStatus => columnByKey.get(columnKey)?.status ?? (columnKey === 'draft' ? 'draft' : 'todo'), [columnByKey])
  const findTaskColumn = useCallback((taskId: number | string): string | null => localTasks.find((task) => task.id === taskId)?.board_column ?? null, [localTasks])
  const getOverColumn = useCallback((overId: string | number): string | null => overId === 'draft' || columnByKey.has(String(overId)) ? String(overId) : findTaskColumn(overId), [columnByKey, findTaskColumn])

  const handleOpenTaskCreate = (): void => { void window.api.taskCreateWindow.open() }
  const handleAddDraft = async (): Promise<void> => { if (!draftInput.trim()) return; try { await addTask(draftInput.trim(), undefined, 'draft'); setDraftInput('') } catch { toast.error(t('kanban.saveFailed')) } }
  const handleDragStart = (event: DragStartEvent): void => { isDraggingRef.current = true; dragRefreshPendingRef.current = false; setDraggingTask(localTasks.find((task) => task.id === event.active.id) ?? null) }
  const handleDragOver = (event: DragOverEvent): void => {
    if (!event.over || hasBoardFilters) return
    const target = getOverColumn(event.over.id)
    const activeId = event.active.id as number
    const active = localTasks.find((task) => task.id === activeId)
    if (!target || !active || active.board_column === target) return
    setLocalTasks((current) => current.map((task) => task.id === activeId ? { ...task, board_column: target, status: targetStatus(target) } : task))
  }
  const prepareMove = (id: number, target: string): PendingComplete | null => {
    const current = localTasks.find((task) => task.id === id)
    if (!current || current.board_column === target) return null
    const sourceTasks = localTasks.filter((task) => task.board_column === current.board_column && task.id !== id).sort((a, b) => a.position - b.position || a.id - b.id)
    const destinationTasks = localTasks.filter((task) => task.board_column === target && task.id !== id).sort((a, b) => a.position - b.position || a.id - b.id)
    return { task: { ...current, board_column: target, status: targetStatus(target) }, target, orderedIds: [...destinationTasks.map((task) => task.id), id], sourceColumn: current.board_column, sourceTaskIds: sourceTasks.map((task) => task.id), sourceStatus: current.status }
  }
  const persistMove = async (move: PendingComplete): Promise<void> => { await reorderTasks(move.orderedIds, move.target, targetStatus(move.target), move.sourceColumn, move.sourceTaskIds, move.sourceStatus) }
  const handleDragEnd = async (event: DragEndEvent): Promise<void> => {
    setDraggingTask(null)
    if (!event.over || hasBoardFilters) { isDraggingRef.current = false; setLocalTasks(useTaskStore.getState().tasks as KanbanTask[]); return }
    const activeId = event.active.id as number
    const active = localTasks.find((task) => task.id === activeId)
    const target = getOverColumn(event.over.id)
    if (!active || !target) { isDraggingRef.current = false; setLocalTasks(useTaskStore.getState().tasks as KanbanTask[]); return }
    const original = tasks.find((task) => task.id === activeId) as KanbanTask | undefined
    const destination = getColumnTasks(target).filter((task) => task.id !== activeId)
    const overIndex = destination.findIndex((task) => task.id === event.over?.id)
    const ordered = [...destination]
    ordered.splice(overIndex >= 0 ? overIndex : ordered.length, 0, active)
    const move: PendingComplete = { task: { ...active, board_column: target, status: targetStatus(target) }, target, orderedIds: ordered.map((task) => task.id), sourceColumn: original && original.board_column !== target ? original.board_column : undefined, sourceTaskIds: original && original.board_column !== target ? localTasks.filter((task) => task.board_column === original.board_column && task.id !== activeId).sort((a, b) => a.position - b.position || a.id - b.id).map((task) => task.id) : [], sourceStatus: original?.status }
    if (move.task.status === 'done' && original?.status !== 'done') { isDraggingRef.current = false; setPendingComplete(move); return }
    try { await persistMove(move) } catch { setLocalTasks(useTaskStore.getState().tasks as KanbanTask[]); toast.error(t('kanban.moveFailed')) } finally {
      isDraggingRef.current = false
      if (dragRefreshPendingRef.current) setLocalTasks(useTaskStore.getState().tasks as KanbanTask[])
      dragRefreshPendingRef.current = false
    }
  }
  const handleUpdate = async (id: number, updates: TaskUpdates): Promise<void> => { try { await updateTask(id, updates) } catch { toast.error(t('kanban.saveFailed')); throw new Error('task update failed') } }
  const handleMove = async (id: number, target: string): Promise<void> => { const move = prepareMove(id, target); if (!move) return; if (move.task.status === 'done') { setPendingComplete(move); return }; try { await persistMove(move) } catch { toast.error(t('kanban.moveFailed')) } }
  const handleDelete = async (id: number): Promise<void> => { const task = localTasks.find((item) => item.id === id); if (!task || !window.confirm(t('kanban.deleteTaskConfirm', { title: task.title }))) return; try { await deleteTask(id); if (activeTask?.id === id) setActiveTask(null); toast.successWithAction(t('kanban.deletedToast'), t('kanban.undo'), () => { void handleUndoDelete(id) }) } catch { toast.error(t('kanban.deleteFailed')) } }
  const handleUndoDelete = async (id?: number): Promise<void> => { try { await undoDelete(id); toast.success(t('kanban.restoredToast')) } catch { toast.error(t('kanban.restoreFailed')) } }
  const handleUndoComplete = async (move: PendingComplete): Promise<void> => {
    const reopen = buildReopenTaskMove({ taskId: move.task.id, targetColumn: move.target, targetStatus: move.task.status, orderedIds: move.orderedIds, sourceColumn: move.sourceColumn, sourceTaskIds: move.sourceTaskIds, sourceStatus: move.sourceStatus })
    if (!reopen) return
    try {
      await reorderTasks(reopen.taskIds, reopen.boardColumn, reopen.status, reopen.sourceBoardColumn, reopen.sourceTaskIds, reopen.sourceStatus)
      toast.success(t('kanban.reopenedToast'))
    } catch {
      toast.error(t('kanban.moveFailed'))
    }
  }
  const handleComplete = async (content: string): Promise<void> => { if (!pendingComplete) return; const completedMove = pendingComplete; try { await completeTask(completedMove.task.id, content); await persistMove(completedMove); setPendingComplete(null); toast.successWithAction(t('kanban.completedToast'), t('kanban.undoComplete'), () => { void handleUndoComplete(completedMove) }) } catch { setLocalTasks(tasks as KanbanTask[]); toast.error(t('kanban.moveFailed')) } }
  const handleCompleteOnly = async (): Promise<void> => { if (!pendingComplete) return; const completedMove = pendingComplete; try { await completeTaskOnly(completedMove.task.id); await persistMove(completedMove); setPendingComplete(null); toast.successWithAction(t('kanban.completedOnlyToast'), t('kanban.undoComplete'), () => { void handleUndoComplete(completedMove) }) } catch { setLocalTasks(tasks as KanbanTask[]); toast.error(t('kanban.moveFailed')) } }
  const handleCancelComplete = async (): Promise<void> => { setPendingComplete(null); await fetchTasks() }
  const handleReopen = async (id: number): Promise<void> => {
    const move = prepareMove(id, 'todo')
    if (!move) return
    try {
      await persistMove(move)
      setActiveTask(null)
      toast.success(t('kanban.reopenedToast'))
    } catch {
      toast.error(t('kanban.moveFailed'))
    }
  }
  const createColumn = async (): Promise<void> => { if (!newColumnName.trim()) return; try { await window.api.kanban.columns.create(newColumnName.trim()); setNewColumnName(''); await fetchColumns() } catch { toast.error(t('kanban.saveFailed')) } }
  const renameColumn = async (column: KanbanColumn): Promise<void> => { if (!editingColumnName.trim()) return; try { await window.api.kanban.columns.update(column.public_id, editingColumnName.trim()); setEditingColumnId(null); await fetchColumns() } catch { toast.error(t('kanban.saveFailed')) } }
  const removeColumn = async (column: KanbanColumn): Promise<void> => { if (!window.confirm(t('kanban.deleteColumnConfirm', { name: column.name }))) return; try { await window.api.kanban.columns.delete(column.public_id); await Promise.all([fetchColumns(), fetchTasks()]) } catch { toast.error(t('kanban.deleteFailed')) } }
  const clearFilters = (): void => { setQuery(''); setShowDone(true); setProjectFilter(''); setPriorityFilter('all'); setDueFilter('all'); setSort('manual') }

  return (
    <DndContext sensors={hasBoardFilters ? [] : sensors} collisionDetection={closestCorners} modifiers={[restrictToWindowEdges]} onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={handleDragEnd} onDragCancel={() => { isDraggingRef.current = false; dragRefreshPendingRef.current = false; setDraggingTask(null); setLocalTasks(useTaskStore.getState().tasks as KanbanTask[]) }}>
      <div className="workspace-page kanban-page">
        <WorkspacePageHeader ariaLabel={t('workspace.breadcrumbLabel')} items={[{ label: t('nav.kanban'), current: true }]} title={t('nav.kanban')} />
        <WorkspaceSectionTabs ariaLabel={t('workspace.sectionNavigation')} items={[{ id: 'board', label: t('nav.kanban'), active: true }, { id: 'drafts', label: t('kanban.drafts'), onClick: () => document.querySelector<HTMLElement>('.kanban-drafts')?.scrollIntoView({ block: 'nearest' }) }]} actions={<><button type="button" onClick={handleOpenTaskCreate} className="ui-button ui-button--primary"><Plus className="h-4 w-4" />{t('kanban.newTask')}</button><button type="button" onClick={() => setColumnsOpen((open) => !open)} aria-expanded={columnsOpen} className="ui-button"><Settings2 className="h-4 w-4" />{t('kanban.manageColumns')}</button></>} />
        <div className="kanban-layout flex gap-4">
          <main className="min-w-0 flex-1">
            <section className="mb-4 flex flex-wrap items-center gap-2" aria-label={t('kanban.filters')}><div className="flex flex-wrap items-center gap-2"><div className="relative min-w-[220px] flex-1"><Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('kanban.searchPlaceholder')} aria-label={t('kanban.searchPlaceholder')} className="w-full rounded-lg border border-zinc-200 bg-zinc-50 py-2 pl-8 pr-3 text-xs outline-none focus:border-blue-400 dark:border-zinc-700 dark:bg-zinc-800" />{query && <button type="button" onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400" aria-label={t('common.clear')}><X className="h-3.5 w-3.5" /></button>}</div><select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)} aria-label={t('kanban.projectFilter')} className="rounded-lg border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-700 dark:bg-zinc-800"><option value="">{t('kanban.allProjects')}</option>{projects.map((project) => <option key={project.public_id} value={project.public_id}>{project.name}</option>)}</select><select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value as TaskPriority | 'all')} aria-label={t('kanban.priorityFilter')} className="rounded-lg border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-700 dark:bg-zinc-800"><option value="all">{t('kanban.allPriorities')}</option><option value="high">{t('kanban.priorityHigh')}</option><option value="medium">{t('kanban.priorityMedium')}</option><option value="low">{t('kanban.priorityLow')}</option></select><select value={dueFilter} onChange={(event) => setDueFilter(event.target.value as KanbanDueFilter)} aria-label={t('kanban.dueFilter')} className="rounded-lg border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-700 dark:bg-zinc-800"><option value="all">{t('kanban.anyDue')}</option><option value="overdue">{t('kanban.overdue')}</option><option value="soon">{t('kanban.dueSoon')}</option><option value="none">{t('kanban.noDueDate')}</option></select><select value={sort} onChange={(event) => setSort(event.target.value as KanbanSort)} aria-label={t('kanban.sort')} className="rounded-lg border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-700 dark:bg-zinc-800"><option value="manual">{t('kanban.manualSort')}</option><option value="due">{t('kanban.dueSort')}</option><option value="priority">{t('kanban.prioritySort')}</option></select><label className="inline-flex items-center gap-1.5 px-1 text-xs text-zinc-500"><input type="checkbox" checked={showDone} onChange={(event) => setShowDone(event.target.checked)} />{t('kanban.showDone')}</label>{hasBoardFilters && <button type="button" onClick={clearFilters} className="rounded-lg px-2 py-2 text-xs text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950/30">{t('kanban.clearFilters')}</button>}</div><div className="mt-2 flex items-center justify-between text-[11px] text-zinc-400"><span>{t('kanban.tasksFound', { count: boardTasks.length })}</span>{hasBoardFilters && <span>{t('kanban.dragDisabledWhileFiltering')}</span>}</div></section>
            {columnsOpen && <div className="mb-4 rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-900/60"><div className="flex gap-2"><input value={newColumnName} onChange={(event) => setNewColumnName(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && void createColumn()} placeholder={t('kanban.columnNamePlaceholder')} aria-label={t('kanban.columnName')} className="min-w-0 flex-1 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-blue-400 dark:border-zinc-700 dark:bg-zinc-800" /><button type="button" onClick={() => void createColumn()} className="ui-button ui-button--primary text-xs"><Plus className="h-3.5 w-3.5" />{t('kanban.addColumn')}</button></div><div className="mt-3 space-y-1.5">{columns.map((column) => <div key={column.public_id} className="flex items-center gap-2 rounded-lg bg-white px-2.5 py-2 text-xs dark:bg-zinc-800"><span className="min-w-0 flex-1 truncate">{column.name}</span>{column.is_system ? <span className="text-zinc-400">{t('kanban.systemColumn')}</span> : editingColumnId === column.public_id ? <><input autoFocus value={editingColumnName} onChange={(event) => setEditingColumnName(event.target.value)} className="min-w-0 flex-1 rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-700" /><button type="button" onClick={() => void renameColumn(column)} className="text-green-500" aria-label={t('kanban.saveEdit')}><Check className="h-3.5 w-3.5" /></button><button type="button" onClick={() => setEditingColumnId(null)} className="text-zinc-400" aria-label={t('kanban.cancelEdit')}><X className="h-3.5 w-3.5" /></button></> : <><button type="button" onClick={() => { setEditingColumnId(column.public_id); setEditingColumnName(column.name) }} className="text-zinc-400 hover:text-blue-500" aria-label={t('kanban.renameColumn')}><Settings2 className="h-3.5 w-3.5" /></button><button type="button" onClick={() => void removeColumn(column)} className="text-zinc-400 hover:text-red-500" aria-label={t('kanban.deleteColumn')}><Trash2 className="h-3.5 w-3.5" /></button></>}</div>)}</div></div>}
            {error && <div className="mb-4 flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"><span>{t(error as Parameters<typeof t>[0])}</span><button type="button" className="ui-button ui-button--secondary" onClick={() => void fetchTasks()}>{t('common.retry')}</button></div>}
            {loading && boardTasks.length === 0 && <div className="mb-4 py-8 text-center text-sm text-zinc-400">{t('common.loading')}</div>}
            {boardTasks.length === 0 && !loading && <div className="mb-4 rounded-xl border border-dashed border-zinc-300 py-12 text-center text-sm text-zinc-400 dark:border-zinc-700">{hasBoardFilters ? t('kanban.noMatches') : t('kanban.dropHere')}</div>}
            <div className="kanban-columns grid gap-4 overflow-x-auto pb-3" style={boardGridStyle}>{columns.map((column) => { const columnTasks = getColumnTasks(column.column_key); return <section key={column.column_key} className="min-w-0"><div className={`mb-3 flex items-center gap-2 border-b-2 pb-2 ${SYSTEM_COLUMN_STYLES[column.column_key] ?? 'border-violet-400'}`}><h3 className="truncate text-sm font-medium text-zinc-700 dark:text-zinc-300">{column.name}</h3><span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-400 dark:bg-zinc-800">{columnTasks.length}</span></div><SortableContext items={columnTasks.map((task) => task.id)} strategy={verticalListSortingStrategy}><DroppableColumn id={column.column_key}><div className="space-y-2">{columnTasks.map((task) => <KanbanTaskCard key={task.id} task={task} onOpen={setActiveTask} onDelete={(id) => void handleDelete(id)} />)}{columnTasks.length === 0 && !hasBoardFilters && <div className="py-8 text-center text-xs text-zinc-400">{t('kanban.dropHere')}</div>}</div></DroppableColumn></SortableContext></section> })}</div>
          </main>
          <aside className={`kanban-drafts flex shrink-0 flex-col rounded-xl border-l border-zinc-200 bg-zinc-50/50 transition-all dark:border-zinc-700 dark:bg-zinc-900/50 ${draftOpen ? 'w-60' : 'w-10'}`}><button type="button" onClick={() => { const next = !draftOpen; setDraftOpen(next); localStorage.setItem('kanban:draftOpen', String(next)) }} className="flex h-10 shrink-0 items-center justify-center rounded-t-xl border-b border-zinc-200 text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800" aria-label={draftOpen ? t('kanban.collapseDrafts') : t('kanban.expandDrafts')}>{draftOpen ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}</button>{!draftOpen && <div className="flex flex-col items-center gap-1 pt-3"><Archive className="h-4 w-4 text-zinc-400" /><span className="text-xs text-zinc-400" style={{ writingMode: 'vertical-rl' }}>{t('kanban.draftsCollapsed', { count: draftTasks.length })}</span></div>}{draftOpen && <div className="kanban-drafts-content flex flex-1 flex-col"><div className="flex items-center gap-2 border-b border-zinc-200 px-3 py-3 dark:border-zinc-700"><Archive className="h-4 w-4 text-zinc-400" /><h3 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('kanban.drafts')}</h3><span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-400 dark:bg-zinc-800">{draftTasks.length}</span></div><p className="px-3 py-2 text-xs text-zinc-400">{t('kanban.draftHelp')}</p><div className="px-3 pb-3"><div className="flex gap-1"><input value={draftInput} onChange={(event) => setDraftInput(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && void handleAddDraft()} placeholder={t('kanban.draftPlaceholder')} className="min-w-0 flex-1 rounded border border-zinc-200 bg-white px-2 py-1.5 text-xs outline-none focus:border-blue-400 dark:border-zinc-600 dark:bg-zinc-800" /><button type="button" onClick={() => void handleAddDraft()} className="rounded bg-zinc-100 px-2 py-1.5 text-zinc-600 hover:bg-zinc-200" aria-label={t('kanban.addDraft')}><Plus className="h-3 w-3" /></button></div></div><SortableContext items={draftTasks.map((task) => task.id)} strategy={verticalListSortingStrategy}><DroppableColumn id="draft"><div className="flex-1 space-y-1.5 overflow-y-auto px-3 pb-3">{draftTasks.map((task) => <KanbanTaskCard key={task.id} task={task} onOpen={setActiveTask} onDelete={(id) => void handleDelete(id)} />)}{draftTasks.length === 0 && <div className="py-6 text-center text-xs text-zinc-400">{t('kanban.noDrafts')}</div>}</div></DroppableColumn></SortableContext></div>}</aside>
        </div>
      </div>
      <DragOverlay>{draggingTask ? <TaskCardOverlay task={draggingTask} /> : null}</DragOverlay>
      {activeTask && <TaskDetailDrawer task={activeTask} columns={columns} projects={projects} onClose={() => setActiveTask(null)} onSave={handleUpdate} onMove={async (id, target) => { await handleMove(id, target); setActiveTask(null) }} onReopen={handleReopen} onDelete={handleDelete} columnName={columnName} />}
      {pendingComplete && <CompleteDialog task={pendingComplete.task} onConfirm={(content) => void handleComplete(content)} onCancel={() => void handleCancelComplete()} onOnlyComplete={() => void handleCompleteOnly()} />}
    </DndContext>
  )
}

export default KanbanPage

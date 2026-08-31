import { useState } from 'react'
import { Calendar, CheckSquare, GripVertical, MoreHorizontal, Trash2 } from 'lucide-react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useI18n } from '../stores/languageStore'
import type { KanbanColumn, KanbanTask } from '../lib/kanbanTypes'

function formatDue(due: string): string {
  const date = new Date(`${due}T00:00:00`)
  return `${date.getMonth() + 1}/${date.getDate()}`
}

function dueClass(due: string | null): string {
  if (!due) return 'text-zinc-400'
  const today = new Date().toISOString().slice(0, 10)
  if (due < today) return 'text-red-500'
  if (due <= new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)) return 'text-amber-500'
  return 'text-zinc-400'
}

function priorityClass(priority: KanbanTask['priority']): string {
  if (priority === 'high') return 'bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-300'
  if (priority === 'low') return 'bg-zinc-100 text-zinc-500 dark:bg-zinc-700 dark:text-zinc-300'
  return 'bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-300'
}

interface KanbanTaskCardProps {
  task: KanbanTask
  columns: KanbanColumn[]
  onOpen: (task: KanbanTask) => void
  onDelete: (id: number) => void
  onMove: (id: number, columnKey: string) => void
  columnName: (columnKey: string) => string
}

export function KanbanTaskCard({ task, columns, onOpen, onDelete, onMove, columnName }: KanbanTaskCardProps): JSX.Element {
  const { t } = useI18n()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id })
  const [menuOpen, setMenuOpen] = useState(false)
  const currentColumn = task.board_column || task.status
  const completed = task.checklist.filter((item) => item.completed).length
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }

  return (
    <article ref={setNodeRef} id={`task-card-${task.public_id}`} style={style} className="group rounded-xl border border-zinc-200 bg-white p-3 shadow-sm transition-all hover:border-zinc-300 hover:shadow-md dark:border-zinc-700 dark:bg-zinc-800 dark:hover:border-zinc-600">
      <div className="flex items-start gap-2">
        <button {...attributes} {...listeners} type="button" className="mt-0.5 shrink-0 cursor-grab p-0.5 text-zinc-300 hover:text-zinc-500 active:cursor-grabbing" aria-label={t('kanban.dragTask')}>
          <GripVertical className="h-4 w-4" />
        </button>
        <button type="button" onClick={() => onOpen(task)} className="min-w-0 flex-1 text-left" aria-label={t('kanban.openDetails')}>
          <div className="flex items-start justify-between gap-2">
            <span className="line-clamp-2 break-words text-sm text-zinc-800 dark:text-zinc-200">{task.title}</span>
            <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${priorityClass(task.priority)}`}>{t(`kanban.priority${task.priority[0].toUpperCase()}${task.priority.slice(1)}` as never)}</span>
          </div>
          {task.description && <p className="mt-1 line-clamp-2 break-words text-xs text-zinc-400">{task.description}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
            {task.due_date && <span className={`inline-flex items-center gap-1 ${dueClass(task.due_date)}`}><Calendar className="h-3 w-3" />{formatDue(task.due_date)}</span>}
            {task.checklist.length > 0 && <span className="inline-flex items-center gap-1 text-zinc-400"><CheckSquare className="h-3 w-3" />{t('kanban.checklistProgress', { completed, total: task.checklist.length })}</span>}
            {task.tag_names.slice(0, 2).map((tag) => <span key={tag} className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-zinc-500 dark:bg-zinc-700 dark:text-zinc-300">#{tag}</span>)}
          </div>
        </button>
        <div className="relative shrink-0">
          <button type="button" onClick={() => setMenuOpen((open) => !open)} className="rounded p-1 text-zinc-300 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-700" aria-label={t('kanban.moreActions')} aria-haspopup="menu" aria-expanded={menuOpen}>
            <MoreHorizontal className="h-4 w-4" />
          </button>
          {menuOpen && <div role="menu" className="absolute right-0 top-7 z-20 min-w-36 rounded-lg border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-800">
            <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onOpen(task) }} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-700">{t('kanban.openDetails')}</button>
            <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onDelete(task.id) }} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30"><Trash2 className="h-3.5 w-3.5" />{t('kanban.deleteTask')}</button>
          </div>}
        </div>
      </div>
      <label className="kanban-move-control mt-2 block border-t border-zinc-100 pt-2 dark:border-zinc-700"><span>{t('kanban.moveTo')}</span><select value="" onChange={(event) => event.target.value && onMove(task.id, event.target.value)} className="mt-1 w-full text-xs"><option value="">{columnName(currentColumn)}</option>{columns.filter((column) => column.column_key !== currentColumn).map((column) => <option key={column.column_key} value={column.column_key}>{column.name}</option>)}{currentColumn !== 'draft' && <option value="draft">{t('kanban.drafts')}</option>}</select></label>
    </article>
  )
}

export function TaskCardOverlay({ task }: { task: KanbanTask }): JSX.Element {
  return <div className="rounded-xl border border-zinc-300 bg-white p-3 shadow-lg dark:border-zinc-600 dark:bg-zinc-800"><p className="text-sm text-zinc-800 dark:text-zinc-200">{task.title}</p></div>
}

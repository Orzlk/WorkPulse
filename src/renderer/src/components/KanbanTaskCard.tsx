import { useEffect, useRef, useState } from 'react'
import { Calendar, CheckSquare, GripVertical, MoreHorizontal, Trash2 } from 'lucide-react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useI18n } from '../stores/languageStore'
import { formatLocalDateKey } from '../lib/kanbanBoard'
import type { KanbanTask } from '../lib/kanbanTypes'

function formatDue(due: string): string {
  const date = new Date(`${due}T00:00:00`)
  return `${date.getMonth() + 1}/${date.getDate()}`
}

function dueClass(due: string): string {
  const today = formatLocalDateKey()
  if (due < today) return 'text-red-500 dark:text-red-400'
  const soon = new Date()
  soon.setDate(soon.getDate() + 2)
  if (due <= formatLocalDateKey(soon)) return 'text-amber-500 dark:text-amber-400'
  return 'text-zinc-400'
}

function priorityClass(priority: KanbanTask['priority']): string {
  if (priority === 'high') return 'bg-[var(--ui-color-danger-soft)] text-[var(--ui-color-danger)]'
  return 'bg-[var(--ui-color-surface-subtle)] text-[var(--ui-color-text-subtle)]'
}

function TaskCardMeta({ task, completed }: { task: KanbanTask; completed: number }): JSX.Element {
  const { t } = useI18n()
  const total = task.checklist.length
  const visibleTags = task.tag_names.slice(0, 2)
  const hiddenTags = task.tag_names.length - visibleTags.length
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
      {task.due_date && <span className={`inline-flex items-center gap-1 ${dueClass(task.due_date)}`}><Calendar className="h-3 w-3" />{formatDue(task.due_date)}</span>}
      {total > 0 && (
        <span className="inline-flex items-center gap-1.5 text-zinc-400" aria-label={t('kanban.checklistProgress', { completed, total })}>
          <CheckSquare className="h-3 w-3" />
          <span className="h-1 w-12 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
            <span className="block h-full rounded-full bg-[var(--ui-color-primary)]" style={{ width: `${Math.round((completed / total) * 100)}%` }} />
          </span>
          {completed}/{total}
        </span>
      )}
      {visibleTags.map((tag) => <span key={tag} className="rounded-full bg-[var(--ui-color-tag-soft)] px-1.5 py-0.5 text-[var(--ui-color-tag)]">#{tag}</span>)}
      {hiddenTags > 0 && <span className="text-zinc-400">+{hiddenTags}</span>}
    </div>
  )
}

interface KanbanTaskCardProps {
  task: KanbanTask
  onOpen: (task: KanbanTask) => void
  onDelete: (id: number) => void
}

export function KanbanTaskCard({ task, onOpen, onDelete }: KanbanTaskCardProps): JSX.Element {
  const { t } = useI18n()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id })
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const completed = task.checklist.filter((item) => item.completed).length
  const isDone = task.status === 'done'
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : isDone ? 0.75 : 1 }

  useEffect(() => {
    if (!menuOpen) return
    const frame = requestAnimationFrame(() => {
      menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
    })
    const closeOnPointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target) && !triggerRef.current?.contains(event.target)) setMenuOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { event.preventDefault(); setMenuOpen(false); triggerRef.current?.focus() }
    }
    document.addEventListener('pointerdown', closeOnPointerDown)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('pointerdown', closeOnPointerDown)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [menuOpen])

  return (
    <article ref={setNodeRef} id={`task-card-${task.public_id}`} style={style} className="group rounded-xl border border-zinc-200 bg-white p-3 shadow-sm transition-all hover:border-zinc-300 hover:shadow-md dark:border-zinc-700 dark:bg-zinc-800 dark:hover:border-zinc-600">
      <div className="flex items-start gap-2">
        <button {...attributes} {...listeners} type="button" className="mt-0.5 shrink-0 cursor-grab p-0.5 text-zinc-400 hover:text-zinc-600 active:cursor-grabbing" aria-label={t('kanban.dragTask')}>
          <GripVertical className="h-4 w-4" />
        </button>
        <button type="button" onClick={() => onOpen(task)} className="min-w-0 flex-1 text-left" aria-label={t('kanban.openDetails')}>
          <div className="flex items-start justify-between gap-2">
            <span className={`line-clamp-2 break-words text-sm text-zinc-800 dark:text-zinc-200 ${isDone ? 'line-through decoration-zinc-400' : ''}`}>{task.title}</span>
            {task.priority !== 'medium' && <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${priorityClass(task.priority)}`}>{t(`kanban.priority${task.priority[0].toUpperCase()}${task.priority.slice(1)}` as never)}</span>}
          </div>
          {task.description && <p className="mt-1 line-clamp-1 break-words text-xs text-zinc-400">{task.description}</p>}
          <TaskCardMeta task={task} completed={completed} />
        </button>
        <div className="relative shrink-0">
          <button ref={triggerRef} type="button" onClick={() => setMenuOpen((open) => !open)} className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-700" aria-label={t('kanban.moreActions')} aria-haspopup="menu" aria-expanded={menuOpen}>
            <MoreHorizontal className="h-4 w-4" />
          </button>
          {menuOpen && <div ref={menuRef} role="menu" aria-label={t('kanban.moreActions')} onKeyDown={(event) => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')); const index = items.indexOf(document.activeElement as HTMLButtonElement); items[(index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus() } }} className="absolute right-0 top-7 z-20 min-w-36 rounded-lg border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-800">
            <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onOpen(task) }} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-700">{t('kanban.openDetails')}</button>
            <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onDelete(task.id) }} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30"><Trash2 className="h-3.5 w-3.5" />{t('kanban.deleteTask')}</button>
          </div>}
        </div>
      </div>
    </article>
  )
}

export function TaskCardOverlay({ task }: { task: KanbanTask }): JSX.Element {
  const completed = task.checklist.filter((item) => item.completed).length
  return (
    <div className="rounded-xl border border-zinc-300 bg-white p-3 shadow-lg dark:border-zinc-600 dark:bg-zinc-800">
      <p className="text-sm text-zinc-800 dark:text-zinc-200">{task.title}</p>
      <TaskCardMeta task={task} completed={completed} />
    </div>
  )
}

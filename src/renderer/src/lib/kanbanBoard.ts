export type KanbanTaskPriority = 'low' | 'medium' | 'high'
export type KanbanTaskStatus = 'todo' | 'in_progress' | 'done' | 'draft'
export type KanbanDueFilter = 'all' | 'overdue' | 'soon' | 'none'
export type KanbanSort = 'manual' | 'due' | 'priority'

export interface KanbanTaskLike {
  id: number
  title: string
  description: string
  status: KanbanTaskStatus
  position: number
  due_date: string | null
  priority: KanbanTaskPriority
  project_id: string | null
  tag_names: string[]
}

export interface KanbanTaskFilters {
  query: string
  showDone: boolean
  projectId?: string
  priority?: KanbanTaskPriority | 'all'
  due?: KanbanDueFilter
  today?: string
  sort: KanbanSort
}

export interface CompletedTaskMove {
  taskId: number
  targetColumn: string
  targetStatus: KanbanTaskStatus
  orderedIds: number[]
  sourceColumn?: string
  sourceTaskIds: number[]
  sourceStatus?: KanbanTaskStatus
}

export interface ReopenTaskMove {
  taskIds: number[]
  boardColumn: string
  status: KanbanTaskStatus
  sourceBoardColumn: string
  sourceTaskIds: number[]
  sourceStatus: KanbanTaskStatus
}

export function formatLocalDateKey(date: Date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function buildReopenTaskMove(move: CompletedTaskMove): ReopenTaskMove | null {
  if (!move.sourceColumn || !move.sourceStatus) return null
  return {
    taskIds: [...move.sourceTaskIds, move.taskId],
    boardColumn: move.sourceColumn,
    status: move.sourceStatus,
    sourceBoardColumn: move.targetColumn,
    sourceTaskIds: move.orderedIds.filter((id) => id !== move.taskId),
    sourceStatus: move.targetStatus
  }
}

const PRIORITY_ORDER: Record<KanbanTaskPriority, number> = { high: 0, medium: 1, low: 2 }

function dueState(dueDate: string | null, today: string): 'overdue' | 'soon' | 'normal' | 'none' {
  if (!dueDate) return 'none'
  if (dueDate < today) return 'overdue'
  const todayTime = new Date(`${today}T00:00:00`).getTime()
  const dueTime = new Date(`${dueDate}T00:00:00`).getTime()
  return dueTime - todayTime <= 2 * 24 * 60 * 60 * 1000 ? 'soon' : 'normal'
}

export function filterAndSortTasks<T extends KanbanTaskLike>(tasks: T[], filters: KanbanTaskFilters): T[] {
  const query = filters.query.trim().toLocaleLowerCase()
  const today = filters.today ?? formatLocalDateKey()
  const filtered = tasks.filter((task) => {
    if (!filters.showDone && task.status === 'done') return false
    if (filters.projectId && task.project_id !== filters.projectId) return false
    if (filters.priority && filters.priority !== 'all' && task.priority !== filters.priority) return false
    if (filters.due && filters.due !== 'all' && dueState(task.due_date, today) !== filters.due) return false
    if (!query) return true
    const searchable = [task.title, task.description, ...task.tag_names].join(' ').toLocaleLowerCase()
    return searchable.includes(query)
  })

  return [...filtered].sort((left, right) => {
    if (filters.sort === 'priority') {
      const priorityDifference = PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority]
      if (priorityDifference !== 0) return priorityDifference
    }
    if (filters.sort === 'due') {
      if (left.due_date === null && right.due_date !== null) return 1
      if (left.due_date !== null && right.due_date === null) return -1
      if (left.due_date && right.due_date && left.due_date !== right.due_date) return left.due_date.localeCompare(right.due_date)
    }
    return left.position - right.position || left.id - right.id
  })
}

import type { TaskPriority } from './kanbanTypes'

export interface TaskCreateDraft {
  content: string
  projectId: string
  priority: TaskPriority
}

export interface TaskCreateRoute {
  isTaskCreate: boolean
  draft: TaskCreateDraft | null
}

export function buildTaskCreateRoute(draft?: TaskCreateDraft): string {
  const params = new URLSearchParams({ window: 'task-create' })
  if (draft) {
    params.set('content', draft.content)
    params.set('projectId', draft.projectId)
    params.set('priority', draft.priority)
  }
  return `?${params.toString()}`
}

export function parseTaskCreateRoute(search: string): TaskCreateRoute {
  const params = new URLSearchParams(search)
  if (params.get('window') !== 'task-create') return { isTaskCreate: false, draft: null }
  const priority = params.get('priority')
  const validPriority: TaskPriority | null = priority === 'low' || priority === 'medium' || priority === 'high' ? priority : null
  const draft = validPriority
    ? { content: params.get('content') ?? '', projectId: params.get('projectId') ?? '', priority: validPriority }
    : null
  return { isTaskCreate: true, draft }
}

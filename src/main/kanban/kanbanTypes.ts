export const TASK_PRIORITIES = ['low', 'medium', 'high'] as const
export type TaskPriority = typeof TASK_PRIORITIES[number]

export interface TaskChecklistItem {
  id: string
  text: string
  completed: boolean
}

export function isTaskPriority(value: unknown): value is TaskPriority {
  return typeof value === 'string' && TASK_PRIORITIES.includes(value as TaskPriority)
}

export function normalizeChecklist(value: unknown): TaskChecklistItem[] {
  if (!Array.isArray(value)) return []
  return value.map((item, index) => {
    if (!item || typeof item !== 'object') return null
    const record = item as Record<string, unknown>
    const text = typeof record.text === 'string' ? record.text.trim().slice(0, 500) : ''
    if (!text) return null
    const id = typeof record.id === 'string' && record.id.trim() ? record.id.trim() : `item-${index + 1}`
    return { id, text, completed: Boolean(record.completed) }
  }).filter((item): item is TaskChecklistItem => item !== null).slice(0, 100)
}

export function parseChecklist(value: unknown): TaskChecklistItem[] {
  if (typeof value !== 'string') return normalizeChecklist(value)
  try {
    return normalizeChecklist(JSON.parse(value))
  } catch {
    return []
  }
}

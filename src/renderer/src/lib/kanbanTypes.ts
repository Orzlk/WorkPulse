import type { WorkItemAssociations } from './workspaceTypes'

export type TaskPriority = 'low' | 'medium' | 'high'
export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'draft'

export interface ChecklistItem {
  id: string
  text: string
  completed: boolean
}

export interface KanbanTask {
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
  tag_names: string[]
  created_at: string
  updated_at: string
  completed_at: string | null
}

export interface KanbanColumn {
  public_id: string
  column_key: string
  name: string
  status: Exclude<TaskStatus, 'draft'>
  position: number
  is_system: boolean
}

export type TaskUpdates = Partial<Pick<KanbanTask, 'title' | 'description' | 'status' | 'board_column' | 'position' | 'due_date' | 'priority' | 'checklist'>> & WorkItemAssociations

export type InboxState = 'unorganized' | 'confirmed' | 'ignored' | 'archived'
export type InboxTarget = 'work_log' | 'task' | 'ignore'

export interface Project {
  public_id: string
  name: string
  description: string
  color: string
  archived_at: string | null
}

export interface InboxSuggestion {
  target: InboxTarget
  title: string
  summary: string
  project_id: string | null
  repository_id: string | null
  tag_names: string[]
  include_in_reports: boolean
}

export interface InboxItem {
  public_id: string
  content: string
  project_id: string | null
  repository_id: string | null
  state: InboxState
  include_in_reports: boolean
  ai_suggestion: InboxSuggestion | null
  created_at: string
  updated_at: string
}

export interface Tag {
  public_id: string
  name: string
  path: string
  parent_id: string | null
}

export interface Page<T> {
  items: T[]
  total: number
}

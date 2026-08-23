export type AsyncStatus = 'idle' | 'running' | 'success' | 'error'

export interface Page<T> {
  items: T[]
  total: number
}

export interface Project {
  public_id: string
  name: string
  description: string
  color: string
  archived_at: string | null
}

export interface Repository {
  public_id: string
  name: string
  remote_url: string | null
  project_id: string | null
  local_path: string
  branch: string | null
  enabled: boolean
  scan_interval_minutes: number | null
  last_scanned_at: string | null
  last_failed_at: string | null
  last_scan_error: string | null
}

export interface InboxSuggestion {
  target: 'work_log' | 'task' | 'ignore'
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
  state: 'unorganized' | 'confirmed' | 'ignored' | 'archived'
  include_in_reports: boolean
  ai_suggestion: InboxSuggestion | null
  created_at: string
  updated_at: string
}

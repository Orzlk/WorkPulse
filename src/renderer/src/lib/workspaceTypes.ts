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
  summary: {
    work_logs: number
    tasks: number
    git_commits: number
    reports: number
  }
}

export interface WorkItemAssociations {
  project_id?: string | null
  repository_id?: string | null
  tag_names?: string[]
}

export interface SearchResult {
  source: 'inbox' | 'work_log' | 'task' | 'git_commit' | 'report'
  public_id: string
  title: string
  excerpt: string
  project_id: string | null
  project_name: string | null
  repository_id: string | null
  repository_name: string | null
  tags: string[]
  time: string
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

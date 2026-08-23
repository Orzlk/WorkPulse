import { ElectronAPI } from '@electron-toolkit/preload'

interface WorkLog {
  id: number
  public_id: string
  content: string
  category: string
  created_at: string
  task_id: number | null
  project_id: string | null
  repository_id: string | null
  tag_names: string[]
}

interface Report {
  id: number
  type: string
  date_from: string
  date_to: string
  content: string
  generated_at: string
}

interface Page<T> {
  items: T[]
  total: number
}

interface Project {
  public_id: string
  name: string
  description: string
  color: string
  archived_at: string | null
  summary: { work_logs: number; tasks: number; git_commits: number; reports: number }
}

interface InboxSuggestion {
  target: 'work_log' | 'task' | 'ignore'
  title: string
  summary: string
  project_id: string | null
  repository_id: string | null
  tag_names: string[]
  include_in_reports: boolean
}

interface InboxItem {
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

interface Tag {
  public_id: string
  name: string
  path: string
  parent_id: string | null
}

interface Repository {
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

interface ReportRequest {
  type: 'weekly' | 'monthly'
  anchorDate: string
  timeZone: string
  projectIds?: string[]
  repositoryIds?: string[]
}

interface PeriodReport {
  public_id: string
  type: string
  period_start: string
  period_end: string
  timezone: string
  project_scope: string[]
  repository_scope: string[]
  content: string
  version: number
  status: 'generating' | 'ready' | 'error'
  error_message: string | null
  retry_count: number
  generated_at: string | null
  updated_at: string
  display_start: string
  display_end_inclusive: string
}

interface Task {
  id: number
  public_id: string
  title: string
  description: string
  status: 'todo' | 'in_progress' | 'done' | 'draft'
  board_column: string
  position: number
  created_at: string
  updated_at: string
  completed_at: string | null
  due_date: string | null
  project_id: string | null
  repository_id: string | null
  tag_names: string[]
}

interface WorkItemAssociations {
  project_id?: string | null
  repository_id?: string | null
  tag_names?: string[]
}

interface SearchResult {
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

type QuickCreateType = 'log' | 'task'
type NavigatePage = 'worklog' | 'kanban' | 'report' | 'stats' | 'settings' | 'inbox' | 'projects' | 'repositories'
type AppLanguage = 'system' | 'zh' | 'en'
type UpdateStatus = 'idle' | 'checking' | 'available' | 'not_available' | 'downloading' | 'downloaded' | 'error'

interface AppUpdateState {
  status: UpdateStatus
  currentVersion: string
  version?: string
  releaseName?: string
  releaseDate?: string
  releaseNotes?: string
  releaseUrl?: string
  downloadUrl?: string
  progress?: number
  error?: string
  canInstall?: boolean
}

export interface API {
  app: {
    setLanguage: (language: AppLanguage) => Promise<void>
    getVersion: () => Promise<string>
    getUpdateState: () => Promise<AppUpdateState>
    checkForUpdates: () => Promise<AppUpdateState>
    installUpdate: () => Promise<boolean>
    openBackupDir: () => Promise<string>
  }
  on: {
    quickCreate: (cb: (type: QuickCreateType) => void) => () => void
    navigate: (cb: (page: NavigatePage) => void) => () => void
    updateStatus: (cb: (state: AppUpdateState) => void) => () => void
  }
  task: {
    add: (title: string, description?: string, status?: 'todo' | 'draft', createdAt?: string, associations?: WorkItemAssociations) => Promise<Task>
    list: () => Promise<Task[]>
    get: (publicId: string) => Promise<Task | null>
    update: (id: number, updates: Partial<Pick<Task, 'title' | 'description' | 'status' | 'position' | 'due_date'>> & WorkItemAssociations) => Promise<Task | null>
    delete: (id: number) => Promise<boolean>
    reorder: (taskIds: number[], status: string) => Promise<void>
    complete: (id: number, logContent: string) => Promise<Task | null>
    completeOnly: (id: number) => Promise<Task | null>
  }
  worklog: {
    add: (content: string, category?: string, associations?: WorkItemAssociations) => Promise<WorkLog>
    get: (publicId: string) => Promise<WorkLog | null>
    list: (limit?: number, offset?: number) => Promise<WorkLog[]>
    byDateRange: (from: string, to: string) => Promise<WorkLog[]>
    search: (keyword: string) => Promise<WorkLog[]>
    categories: () => Promise<string[]>
    setCategory: (id: number, category: string) => Promise<void>
    update: (id: number, content: string, category: string, created_at?: string, associations?: WorkItemAssociations) => Promise<WorkLog | null>
    delete: (id: number) => Promise<boolean>
    restore: (log: Pick<WorkLog, 'content' | 'category' | 'created_at' | 'task_id'>) => Promise<WorkLog>
  }
  stats: {
    get: (days?: number) => Promise<{
      daily: { date: string; log_count: number; task_completed: number }[]
      totalLogs: number
      totalTasksDone: number
      totalTasksActive: number
      streak: number
    }>
  }
  report: {
    generate: (request: ReportRequest) => Promise<PeriodReport>
    list: (limit?: number) => Promise<PeriodReport[]>
    get: (publicId: string) => Promise<PeriodReport | null>
    update: (publicId: string, input: { content: string }) => Promise<PeriodReport | null>
  }
  project: {
    list: (pagination?: { limit?: number; offset?: number }) => Promise<Page<Project>>
    create: (input: Omit<Project, 'public_id' | 'archived_at' | 'summary'>) => Promise<Project>
    update: (publicId: string, input: Partial<Omit<Project, 'public_id' | 'archived_at' | 'summary'>>) => Promise<Project | null>
    archive: (publicId: string) => Promise<Project | null>
  }
  inbox: {
    list: (pagination?: { limit?: number; offset?: number }) => Promise<Page<InboxItem>>
    get: (publicId: string) => Promise<InboxItem | null>
    create: (input: Omit<InboxItem, 'public_id' | 'state' | 'created_at' | 'updated_at'>) => Promise<InboxItem>
    update: (publicId: string, input: Partial<Omit<InboxItem, 'public_id' | 'state' | 'created_at' | 'updated_at'>>) => Promise<InboxItem | null>
    organize: (publicId: string) => Promise<{ target: string; target_public_id: string | null }>
    ignore: (publicId: string) => Promise<InboxItem | null>
    archive: (publicId: string) => Promise<InboxItem | null>
  }
  tag: {
    list: (pagination?: { limit?: number; offset?: number }) => Promise<Page<Tag>>
    create: (name: string) => Promise<Tag>
    rename: (publicId: string, name: string) => Promise<Tag | null>
    search: (query: string, pagination?: { limit?: number; offset?: number }) => Promise<Page<Tag>>
  }
  search: {
    query: (input: { text?: string; tag_names?: string[]; project_id?: string | null; repository_id?: string | null; state?: InboxItem['state']; limit?: number; offset?: number }) => Promise<Page<SearchResult>>
  }
  repository: {
    list: (pagination?: { limit?: number; offset?: number }) => Promise<Page<Repository>>
    get: (publicId: string) => Promise<Repository | null>
    create: (input: { name: string; local_path: string; remote_url?: string | null; project_id?: string | null; enabled?: boolean; scan_interval_minutes?: number | null }) => Promise<Repository>
    update: (publicId: string, input: { project_id?: string | null; enabled?: boolean; scan_interval_minutes?: number | null }) => Promise<Repository | null>
    scan: (publicId: string) => Promise<{ repository_id: string; status: 'succeeded' | 'failed' | 'skipped'; inserted_count: number; error?: string }>
    scanAll: () => Promise<{
      succeeded: number
      failed: number
      commits: number
      errors: Array<{ repository_id: string; error: string }>
      results: Array<{ repository_id: string; status: 'succeeded' | 'failed' | 'skipped'; inserted_count: number; error?: string }>
    }>
  }
  database: {
    export: () => Promise<{ filePath: string; preview: unknown } | null>
    import: (request: { action: 'preview' } | { action: 'merge'; token: string }) => Promise<{ token: string; preview: unknown } | { inserted: number; conflicts: number; skipped: number; conflict_public_ids: string[] } | null>
  }
  settings: {
    get: (key: string) => Promise<string | null>
    set: (key: string, value: string) => Promise<void>
    delete: (key: string) => Promise<void>
  }
  shortcut: {
    update: (key: string, value: string) => Promise<boolean>
  }
  export: {
    logs: (format: 'csv' | 'markdown') => Promise<string | null>
    report: (content: string, dateRange: string) => Promise<string | null>
  }
  import: {
    logs: () => Promise<{ imported: number; skipped: number; filePath: string } | null>
  }
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: API
  }
}

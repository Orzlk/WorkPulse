import { ElectronAPI } from '@electron-toolkit/preload'

interface WorkLog {
  id: number
  public_id: string
  content: string
  category: string
  created_at: string
  task_id: number | null
  project_id: string | null
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

interface ClearWorkspaceDataResult {
  backupPath: string
  deleted: Record<string, number>
}

interface Project {
  public_id: string
  name: string
  description: string
  color: string
  archived_at: string | null
  summary: { work_logs: number; tasks: number; git_commits: number; reports: number }
}

interface ProjectActivityItem {
  public_id: string
  type: 'task' | 'work_log' | 'inbox' | 'git_commit' | 'report'
  title: string
  content: string
  occurred_at: string
  status: string | null
  category: string | null
  repository_name: string | null
  author_name: string | null
  author_email: string | null
  commit_hash: string | null
  branch: string | null
  files_changed: number | null
  additions: number | null
  deletions: number | null
  due_date: string | null
}

interface InboxSuggestion {
  target: 'work_log' | 'task' | 'ignore'
  title: string
  summary: string
  project_id: string | null
  tag_names: string[]
  include_in_reports: boolean
}

interface InboxItem {
  public_id: string
  content: string
  project_id: string | null
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
  usage_count?: number
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
  source_snapshot?: { schema_version: number | string; unavailable?: boolean }
}

interface ReportPreview {
  type: 'weekly' | 'monthly'
  display_start: string
  display_end_inclusive: string
  project_count: number
  repository_count: number
  work_log_count: number
  task_count: number
  inbox_count: number
  git_commit_count: number
  unorganized_inbox_count: number
}

interface ReportStreamEvent {
  request_id: string
  type: 'stage' | 'chunk' | 'done' | 'error'
  stage?: 'reading' | 'generating'
  chunk?: string
  report?: PeriodReport
  code?: 'cancelled' | 'failed'
  message?: string
}

interface SavedAttachment {
  id: string
  fileName: string
  mimeType: string
  size: number
  url: string
}

interface AiConnectionTestResult {
  ok: boolean
  provider: 'openai' | 'anthropic' | 'deepseek'
  model: string
  latency_ms: number
  error?: string
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
  priority: 'low' | 'medium' | 'high'
  checklist: Array<{ id: string; text: string; completed: boolean }>
  project_id: string | null
  tag_names: string[]
}

interface KanbanColumn {
  public_id: string
  column_key: string
  name: string
  status: 'todo' | 'in_progress' | 'done'
  position: number
  is_system: boolean
}

interface WorkItemAssociations {
  project_id?: string | null
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
type TaskCreateDraft = { content: string; projectId: string; priority: 'low' | 'medium' | 'high'; route?: string }
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
  worklogEditor: {
    open: (publicId: string) => Promise<boolean>
    setDirty: (isDirty: boolean) => void
    notifyChanged: (publicId: string) => void
    close: () => void
  }
  taskCreateWindow: {
    open: (draft?: TaskCreateDraft) => Promise<boolean>
    setDirty: (isDirty: boolean) => void
    notifyChanged: (publicId: string) => void
    close: (discard?: boolean) => void
  }
  on: {
    quickCreate: (cb: (type: QuickCreateType) => void) => () => void
    taskCreateDraft: (cb: (draft: TaskCreateDraft) => void) => () => void
    navigate: (cb: (page: NavigatePage) => void) => () => void
    updateStatus: (cb: (state: AppUpdateState) => void) => () => void
    worklogEditorChanged: (cb: (publicId: string) => void) => () => void
    taskCreateChanged: (cb: (publicId: string) => void) => () => void
    reportStream: (cb: (event: ReportStreamEvent) => void) => () => void
  }
  task: {
    add: (title: string, description?: string, status?: 'todo' | 'draft', createdAt?: string, associations?: WorkItemAssociations, priority?: Task['priority'], dueDate?: string | null, checklist?: Task['checklist']) => Promise<Task>
    list: () => Promise<Task[]>
    get: (publicId: string) => Promise<Task | null>
    update: (id: number, updates: Partial<Pick<Task, 'title' | 'description' | 'status' | 'board_column' | 'position' | 'due_date' | 'priority' | 'checklist'>> & WorkItemAssociations) => Promise<Task | null>
    delete: (id: number) => Promise<boolean>
    restore: (id: number) => Promise<Task | null>
    reorder: (taskIds: number[], boardColumn: string, status?: Task['status'], sourceBoardColumn?: string, sourceTaskIds?: number[], sourceStatus?: Task['status']) => Promise<void>
    complete: (id: number, logContent: string) => Promise<Task | null>
    completeOnly: (id: number) => Promise<Task | null>
  }
  kanban: {
    columns: {
      list: () => Promise<KanbanColumn[]>
      create: (name: string) => Promise<KanbanColumn>
      update: (publicId: string, name: string) => Promise<KanbanColumn | null>
      delete: (publicId: string) => Promise<boolean>
    }
  }
  worklog: {
    add: (content: string, category?: string, associations?: WorkItemAssociations) => Promise<WorkLog>
    get: (publicId: string) => Promise<WorkLog | null>
    list: (limit?: number, offset?: number, tagPath?: string, projectPublicId?: string) => Promise<WorkLog[]>
    byDateRange: (from: string, to: string) => Promise<WorkLog[]>
    search: (keyword: string, tagPath?: string, projectPublicId?: string) => Promise<WorkLog[]>
    categories: () => Promise<string[]>
    setCategory: (id: number, category: string) => Promise<void>
    update: (id: number, content: string, category: string, created_at?: string, associations?: WorkItemAssociations) => Promise<WorkLog | null>
    delete: (id: number) => Promise<boolean>
    restore: (log: Pick<WorkLog, 'content' | 'category' | 'created_at' | 'task_id' | 'project_id' | 'tag_names'> & Partial<Pick<WorkLog, 'id' | 'public_id'>>) => Promise<WorkLog>
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
    startStream: (request: ReportRequest) => Promise<string>
    cancel: (requestId: string) => Promise<void>
    preview: (request: ReportRequest) => Promise<ReportPreview>
    list: (limit?: number) => Promise<PeriodReport[]>
    get: (publicId: string) => Promise<PeriodReport | null>
    update: (publicId: string, input: { content: string }) => Promise<PeriodReport | null>
  }
  ai: {
    testConnection: (input: { provider: 'openai' | 'anthropic' | 'deepseek'; api_key: string; base_url?: string; model?: string }) => Promise<AiConnectionTestResult>
  }
  project: {
    list: (pagination?: { limit?: number; offset?: number }) => Promise<Page<Project>>
    activity: (publicId: string) => Promise<ProjectActivityItem[]>
    create: (input: Omit<Project, 'public_id' | 'archived_at' | 'summary'>) => Promise<Project>
    update: (publicId: string, input: Partial<Omit<Project, 'public_id' | 'archived_at' | 'summary'>>) => Promise<Project | null>
    archive: (publicId: string) => Promise<Project | null>
  }
  inbox: {
    list: (pagination?: { limit?: number; offset?: number; state?: InboxItem['state'] }) => Promise<Page<InboxItem>>
    get: (publicId: string) => Promise<InboxItem | null>
    create: (input: Omit<InboxItem, 'public_id' | 'state' | 'created_at' | 'updated_at'>) => Promise<InboxItem>
    update: (publicId: string, input: Partial<Omit<InboxItem, 'public_id' | 'state' | 'created_at' | 'updated_at'>>) => Promise<InboxItem | null>
    organize: (publicId: string, options?: { target: 'work_log' | 'task' | 'ignore'; project_id?: string | null; tag_names?: string[]; title?: string; include_in_reports?: boolean }) => Promise<{ target: string; target_public_id: string | null }>
    aiOrganize: (input?: { public_ids?: string[]; limit?: number }) => Promise<{ processed: number; updated: number; failed: number; items: InboxItem[] }>
    ignore: (publicId: string) => Promise<InboxItem | null>
    archive: (publicId: string) => Promise<InboxItem | null>
    delete: (publicId: string) => Promise<InboxItem | null>
  }
  tag: {
    list: (pagination?: { limit?: number; offset?: number }) => Promise<Page<Tag>>
    create: (name: string) => Promise<Tag>
    rename: (publicId: string, name: string) => Promise<Tag | null>
    search: (query: string, pagination?: { limit?: number; offset?: number }) => Promise<Page<Tag>>
  }
  attachment: {
    save: (input: { fileName: string; mimeType: string; data: ArrayBuffer }) => Promise<SavedAttachment>
  }
  search: {
    query: (input: { text?: string; tag_names?: string[]; project_id?: string | null; repository_id?: string | null; state?: InboxItem['state']; limit?: number; offset?: number }) => Promise<Page<SearchResult>>
  }
  repository: {
    list: (pagination?: { limit?: number; offset?: number }) => Promise<Page<Repository>>
    get: (publicId: string) => Promise<Repository | null>
    create: (input: { name: string; local_path: string; remote_url?: string | null; project_id?: string | null; enabled?: boolean; scan_interval_minutes?: number | null }) => Promise<Repository>
    update: (publicId: string, input: { name?: string; local_path?: string; remote_url?: string | null; project_id?: string | null; enabled?: boolean; scan_interval_minutes?: number | null }) => Promise<Repository | null>
    delete: (publicId: string) => Promise<Repository | null>
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
    archiveExport: () => Promise<{ filePath: string; preview: unknown; attachments: number } | null>
    import: (request: { action: 'preview' } | { action: 'merge'; token: string }) => Promise<{ token: string; preview: unknown } | { inserted: number; conflicts: number; skipped: number; conflict_public_ids: string[] } | null>
    archiveImport: (request: { action: 'preview' } | { action: 'merge'; token: string }) => Promise<{ token: string; preview: unknown; attachments?: number } | { inserted: number; conflicts: number; skipped: number; conflict_public_ids: string[] } | null>
    clear: () => Promise<ClearWorkspaceDataResult>
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
    logs: () => Promise<{
      imported: number
      skipped: number
      filePath: string
      source: 'file' | 'flomo'
      attachmentsImported: number
      attachmentsSkipped: number
    } | null>
  }
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: API
  }
}

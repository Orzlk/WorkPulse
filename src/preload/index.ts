import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { API } from './index.d'

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

const api = {
  app: {
    setLanguage: (language: AppLanguage) => ipcRenderer.invoke('app:language:update', language),
    getVersion: () => ipcRenderer.invoke('app:get-version') as Promise<string>,
    getUpdateState: () => ipcRenderer.invoke('app:updates:get-state') as Promise<AppUpdateState>,
    checkForUpdates: () => ipcRenderer.invoke('app:updates:check') as Promise<AppUpdateState>,
    installUpdate: () => ipcRenderer.invoke('app:updates:install') as Promise<boolean>,
    openBackupDir: () => ipcRenderer.invoke('app:open-backup-dir') as Promise<string>
  },
  worklogEditor: {
    open: (publicId: string) => ipcRenderer.invoke('worklog-editor:open', publicId) as Promise<boolean>,
    setDirty: (isDirty: boolean) => {
      ipcRenderer.send('worklog-editor:set-dirty', isDirty)
    },
    notifyChanged: (publicId: string) => {
      ipcRenderer.send('worklog-editor:changed', publicId)
    },
    close: () => {
      ipcRenderer.send('worklog-editor:close')
    }
  },
  worklog: {
    add: (content: string, category?: string, associations?: WorkItemAssociations) =>
      ipcRenderer.invoke('worklog:add', content, category, associations),
    get: (publicId: string) => ipcRenderer.invoke('worklog:get', publicId) as Promise<WorkLog | null>,
    list: (limit?: number, offset?: number, tagPath?: string, projectPublicId?: string) =>
      ipcRenderer.invoke('worklog:list', limit, offset, tagPath, projectPublicId),
    byDateRange: (from: string, to: string) =>
      ipcRenderer.invoke('worklog:byDateRange', from, to),
    search: (keyword: string, tagPath?: string, projectPublicId?: string) => ipcRenderer.invoke('worklog:search', keyword, tagPath, projectPublicId),
    categories: () => ipcRenderer.invoke('worklog:categories') as Promise<string[]>,
    setCategory: (id: number, category: string) =>
      ipcRenderer.invoke('worklog:setCategory', id, category),
    update: (id: number, content: string, category: string, created_at?: string, associations?: WorkItemAssociations) =>
      ipcRenderer.invoke('worklog:update', id, content, category, created_at, associations),
    delete: (id: number) => ipcRenderer.invoke('worklog:delete', id),
    restore: (log: { content: string; category: string; created_at: string; task_id: number | null; project_id: string | null; repository_id: string | null; tag_names: string[] }) =>
      ipcRenderer.invoke('worklog:restore', log)
  },
  task: {
    add: (title: string, description?: string, status?: 'todo' | 'draft', createdAt?: string, associations?: WorkItemAssociations) =>
      ipcRenderer.invoke('task:add', title, description, status, createdAt, associations),
    list: () => ipcRenderer.invoke('task:list'),
    get: (publicId: string) => ipcRenderer.invoke('task:get', publicId) as Promise<Task | null>,
    update: (id: number, updates: Partial<Pick<Task, 'title' | 'description' | 'status' | 'position' | 'due_date'>> & WorkItemAssociations) =>
      ipcRenderer.invoke('task:update', id, updates),
    delete: (id: number) => ipcRenderer.invoke('task:delete', id),
    reorder: (taskIds: number[], status: string) =>
      ipcRenderer.invoke('task:reorder', taskIds, status),
    complete: (id: number, logContent: string) =>
      ipcRenderer.invoke('task:complete', id, logContent),
    completeOnly: (id: number) =>
      ipcRenderer.invoke('task:completeOnly', id) as Promise<Task | null>
  },
  stats: {
    get: (days?: number) => ipcRenderer.invoke('stats:get', days)
  },
  report: {
    generate: (request: ReportRequest) =>
      ipcRenderer.invoke('report:generate', request) as Promise<PeriodReport>,
    startStream: (request: ReportRequest) =>
      ipcRenderer.invoke('report:stream:start', request) as Promise<string>,
    cancel: (requestId: string) =>
      ipcRenderer.invoke('report:stream:cancel', requestId) as Promise<void>,
    preview: (request: ReportRequest) =>
      ipcRenderer.invoke('report:preview', request) as Promise<ReportPreview>,
    list: (limit?: number) => ipcRenderer.invoke('report:list', limit) as Promise<PeriodReport[]>,
    get: (publicId: string) => ipcRenderer.invoke('report:get', publicId) as Promise<PeriodReport | null>,
    update: (publicId: string, input: { content: string }) =>
      ipcRenderer.invoke('report:update', publicId, input) as Promise<PeriodReport | null>
  },
  ai: {
    testConnection: (input: { provider: 'openai' | 'anthropic' | 'deepseek'; api_key: string; base_url?: string; model?: string }) =>
      ipcRenderer.invoke('ai:testConnection', input) as Promise<AiConnectionTestResult>
  },
  project: {
    list: (pagination?: { limit?: number; offset?: number }) => ipcRenderer.invoke('project:list', pagination) as Promise<Page<Project>>,
    create: (input: Omit<Project, 'public_id' | 'archived_at' | 'summary'>) => ipcRenderer.invoke('project:create', input) as Promise<Project>,
    update: (publicId: string, input: Partial<Omit<Project, 'public_id' | 'archived_at' | 'summary'>>) => ipcRenderer.invoke('project:update', publicId, input) as Promise<Project | null>,
    archive: (publicId: string) => ipcRenderer.invoke('project:archive', publicId) as Promise<Project | null>
  },
  inbox: {
    list: (pagination?: { limit?: number; offset?: number; state?: InboxItem['state'] }) => ipcRenderer.invoke('inbox:list', pagination) as Promise<Page<InboxItem>>,
    get: (publicId: string) => ipcRenderer.invoke('inbox:get', publicId) as Promise<InboxItem | null>,
    create: (input: Omit<InboxItem, 'public_id' | 'state' | 'created_at' | 'updated_at'>) => ipcRenderer.invoke('inbox:create', input) as Promise<InboxItem>,
    update: (publicId: string, input: Partial<Omit<InboxItem, 'public_id' | 'state' | 'created_at' | 'updated_at'>>) => ipcRenderer.invoke('inbox:update', publicId, input) as Promise<InboxItem | null>,
    organize: (publicId: string) => ipcRenderer.invoke('inbox:organize', publicId) as Promise<{ target: string; target_public_id: string | null }>,
    aiOrganize: (input?: { public_ids?: string[]; limit?: number }) =>
      ipcRenderer.invoke('inbox:ai-organize', input) as Promise<{ processed: number; updated: number; failed: number; items: InboxItem[] }>,
    ignore: (publicId: string) => ipcRenderer.invoke('inbox:ignore', publicId) as Promise<InboxItem | null>,
    archive: (publicId: string) => ipcRenderer.invoke('inbox:archive', publicId) as Promise<InboxItem | null>
  },
  tag: {
    list: (pagination?: { limit?: number; offset?: number }) => ipcRenderer.invoke('tag:list', pagination) as Promise<Page<Tag>>,
    create: (name: string) => ipcRenderer.invoke('tag:create', name) as Promise<Tag>,
    rename: (publicId: string, name: string) => ipcRenderer.invoke('tag:rename', publicId, name) as Promise<Tag | null>,
    search: (query: string, pagination?: { limit?: number; offset?: number }) => ipcRenderer.invoke('tag:search', query, pagination) as Promise<Page<Tag>>
  },
  attachment: {
    save: (input: { fileName: string; mimeType: string; data: ArrayBuffer }) =>
      ipcRenderer.invoke('attachment:save', input) as Promise<SavedAttachment>
  },
  search: {
    query: (input: { text?: string; tag_names?: string[]; project_id?: string | null; repository_id?: string | null; state?: InboxItem['state']; limit?: number; offset?: number }) => ipcRenderer.invoke('search:query', input) as Promise<Page<SearchResult>>
  },
  repository: {
    list: (pagination?: { limit?: number; offset?: number }) => ipcRenderer.invoke('repository:list', pagination) as Promise<Page<Repository>>,
    get: (publicId: string) => ipcRenderer.invoke('repository:get', publicId) as Promise<Repository | null>,
    create: (input: { name: string; local_path: string; remote_url?: string | null; project_id?: string | null; enabled?: boolean; scan_interval_minutes?: number | null }) => ipcRenderer.invoke('repository:create', input) as Promise<Repository>,
    update: (publicId: string, input: { name?: string; local_path?: string; remote_url?: string | null; project_id?: string | null; enabled?: boolean; scan_interval_minutes?: number | null }) => ipcRenderer.invoke('repository:update', publicId, input) as Promise<Repository | null>,
    delete: (publicId: string) => ipcRenderer.invoke('repository:delete', publicId) as Promise<Repository | null>,
    scan: (publicId: string) => ipcRenderer.invoke('repository:scan', publicId) as Promise<{ repository_id: string; status: 'succeeded' | 'failed' | 'skipped'; inserted_count: number; error?: string }>,
    scanAll: () => ipcRenderer.invoke('repository:scanAll') as Promise<{
      succeeded: number
      failed: number
      commits: number
      errors: Array<{ repository_id: string; error: string }>
      results: Array<{ repository_id: string; status: 'succeeded' | 'failed' | 'skipped'; inserted_count: number; error?: string }>
    }>
  },
  database: {
    export: () => ipcRenderer.invoke('database:export') as Promise<{ filePath: string; preview: unknown } | null>,
    import: (request: { action: 'preview' } | { action: 'merge'; token: string }) => ipcRenderer.invoke('database:import', request) as Promise<{ token: string; preview: unknown } | { inserted: number; conflicts: number; skipped: number; conflict_public_ids: string[] } | null>,
    clear: () => ipcRenderer.invoke('database:clear') as Promise<ClearWorkspaceDataResult>
  },
  settings: {
    get: (key: string) => ipcRenderer.invoke('settings:get', key),
    set: (key: string, value: string) => ipcRenderer.invoke('settings:set', key, value),
    delete: (key: string) => ipcRenderer.invoke('settings:delete', key)
  },
  shortcut: {
    update: (key: string, value: string) => ipcRenderer.invoke('shortcut:update', key, value)
  },
  export: {
    logs: (format: 'csv' | 'markdown') => ipcRenderer.invoke('export:logs', format),
    report: (content: string, dateRange: string) =>
      ipcRenderer.invoke('export:report', content, dateRange)
  },
  import: {
    logs: () =>
      ipcRenderer.invoke('import:logs') as Promise<{
        imported: number
        skipped: number
        filePath: string
        source: 'file' | 'flomo'
        attachmentsImported: number
        attachmentsSkipped: number
      } | null>
  },
  on: {
    quickCreate: (cb: (type: QuickCreateType) => void) => {
      const logHandler = (): void => cb('log')
      const taskHandler = (): void => cb('task')
      ipcRenderer.on('quick-create:log', logHandler)
      ipcRenderer.on('quick-create:task', taskHandler)
      return () => {
        ipcRenderer.removeListener('quick-create:log', logHandler)
        ipcRenderer.removeListener('quick-create:task', taskHandler)
      }
    },
    navigate: (cb: (page: NavigatePage) => void) => {
      const pages: NavigatePage[] = ['worklog', 'kanban', 'report', 'stats', 'settings', 'inbox', 'projects', 'repositories']
      const handlers = pages.map((page) => {
        const handler = (): void => cb(page)
        ipcRenderer.on(`navigate:${page}`, handler)
        return { page, handler }
      })
      return () => {
        handlers.forEach(({ page, handler }) =>
          ipcRenderer.removeListener(`navigate:${page}`, handler)
        )
      }
    },
    updateStatus: (cb: (state: AppUpdateState) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, state: AppUpdateState): void => cb(state)
      ipcRenderer.on('app:update-status', handler)
      return () => {
        ipcRenderer.removeListener('app:update-status', handler)
      }
    },
    worklogEditorChanged: (cb: (publicId: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, publicId: unknown): void => {
        if (typeof publicId === 'string') cb(publicId)
      }
      ipcRenderer.on('worklog-editor:changed', handler)
      return () => {
        ipcRenderer.removeListener('worklog-editor:changed', handler)
      }
    },
    reportStream: (cb: (event: ReportStreamEvent) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, value: ReportStreamEvent): void => cb(value)
      ipcRenderer.on('report:stream', handler)
      return () => {
        ipcRenderer.removeListener('report:stream', handler)
      }
    }
  }
} satisfies API

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore
  window.electron = electronAPI
  // @ts-ignore
  window.api = api
}

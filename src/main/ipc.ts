import { ipcMain, dialog, app, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync, readFileSync, statSync, unlinkSync } from 'fs'
import { dirname, join } from 'path'
import {
  addWorkLog,
  addWorkLogsBatch,
  getWorkLogs,
  getWorkLogsByDateRange,
  getWorkLogByPublicId,
  searchWorkLogs,
  getAllWorkLogs,
  getStats,
  getCategories,
  updateWorkLogCategory,
  updateWorkLog,
  deleteWorkLog,
  restoreWorkLog,
  getSetting,
  setSetting,
  deleteSetting,
  clearWorkspaceData,
  addTask,
  getTasks,
  getTaskByPublicId,
  updateTask,
  deleteTask,
  restoreTask,
  reorderTasks,
  completeTask,
  getKanbanColumns,
  createKanbanColumn,
  updateKanbanColumn,
  deleteKanbanColumn,
  workLogExists,
  type KanbanColumn
} from './db'
import { deleteStoredApiKey, getStoredApiKey, setStoredApiKey } from './secureSettings'
import { tMain } from './i18n'
import { getDatabase, getDefaultWorkspaceContext } from './db'
import { ProjectService } from './services/projectService'
import { InboxService } from './services/inboxService'
import { TagService } from './services/tagService'
import { SearchService } from './services/searchService'
import { RepositoryService } from './services/repositoryService'
import { ReportService } from './reports/reportService'
import { testAiConnection } from './reports/aiProvider'
import { generateInboxSuggestion } from './ai'
import { saveAttachment, stageAttachmentsForClear } from './attachments/attachmentStorage'
import { MAX_ARCHIVE_BYTES, readAttachmentArchive, type AttachmentArchiveEntry } from './attachments/attachmentArchive'
import {
  IpcContractError,
  id,
  parseInboxInput,
  parsePagination,
  parseInboxListInput,
  parseProjectInput,
  parseReportListInput,
  parseReportRequest,
  parseStatsDays,
  parseAiConnectionTestInput,
  parseAttachmentInput,
  parseInboxAiInput,
  parseRepositoryCreateInput,
  parseRepositoryUpdateInput,
  parseSearchQueryInput,
  parseWorkLogCreateArgs,
  parseWorkLogUpdateArgs,
  parseTaskCreateArgs,
  parseTaskUpdateArgs,
  parseTaskReorderArgs,
  parseSettingUpdateArgs,
  toIpcContractError
} from './ipcContracts'
import { createDatabaseExport, mergeDatabaseImport, previewDatabaseImport } from './database/transfer'
import { createWorkspaceBackup } from './database/workspaceBackup'
import { ImportTokenStore } from './database/importTokenStore'
import { parseFlomoHtml } from './importers/flomoHtmlImporter'
import { assertImportFileSize, buildImportKey, importFlomoMemos } from './importers/flomoLogImport'

const MAX_IMPORT_BYTES = 20 * 1024 * 1024
const INBOX_AI_TIMEOUT_MS = 60_000
const pendingImports = new ImportTokenStore<unknown>(10 * 60 * 1000)
const pendingArchiveImports = new ImportTokenStore<{ entries: AttachmentArchiveEntry[]; payload: unknown }>(10 * 60 * 1000)

type ReportStreamEvent =
  | { request_id: string; type: 'stage'; stage: 'reading' | 'generating' }
  | { request_id: string; type: 'chunk'; chunk: string }
  | { request_id: string; type: 'done'; report: unknown }
  | { request_id: string; type: 'error'; code: 'cancelled' | 'failed'; message: string }

const reportStreams = new Map<string, { controller: AbortController; senderId: number; sender: Electron.WebContents }>()

async function withTimeout<T>(work: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work(controller.signal),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort()
          reject(new Error('AI inbox organization timed out'))
        }, timeoutMs)
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
    controller.abort()
  }
}

function sendReportStreamEvent(sender: Electron.WebContents, event: ReportStreamEvent): void {
  if (!sender.isDestroyed()) sender.send('report:stream', event)
}

function services(): {
  projects: ProjectService
  inbox: InboxService
  tags: TagService
  search: SearchService
  repositories: RepositoryService
  reports: ReportService
} {
  const database = getDatabase()
  const context = getDefaultWorkspaceContext()
  return {
    projects: new ProjectService(database, context),
    inbox: new InboxService(database, context),
    tags: new TagService(database, context),
    search: new SearchService(database, context),
    repositories: new RepositoryService(database, context),
    reports: new ReportService(database, context)
  }
}

function guarded<TArgs extends unknown[], TResult>(handler: (...args: TArgs) => TResult | Promise<TResult>) {
  return async (_event: Electron.IpcMainInvokeEvent, ...args: TArgs): Promise<TResult> => {
    try {
      return await handler(...args)
    } catch (error) {
      // 未归类的异常会以 INTERNAL_ERROR 返回渲染层；在此保留底层错误便于排查运行时问题
      console.error('[ipc] unhandled handler error', error)
      throw toIpcContractError(error)
    }
  }
}

function guardedWithEvent<TArgs extends unknown[], TResult>(handler: (event: Electron.IpcMainInvokeEvent, ...args: TArgs) => TResult | Promise<TResult>) {
  return async (event: Electron.IpcMainInvokeEvent, ...args: TArgs): Promise<TResult> => {
    try {
      return await handler(event, ...args)
    } catch (error) {
      throw toIpcContractError(error)
    }
  }
}

export function registerIpcHandlers(): void {
  // --- Work Logs ---

  ipcMain.handle('worklog:add', guarded((content: unknown, category?: unknown, associations?: unknown) => {
    const input = parseWorkLogCreateArgs({ content, category, associations })
    return addWorkLog(input.content, input.category, null, undefined, input.associations)
  }))

  ipcMain.handle('worklog:list', guarded((limit?: number, offset?: number, tagPath?: string, projectPublicId?: string) => {
    return getWorkLogs(limit, offset, tagPath, projectPublicId)
  }))

  ipcMain.handle('worklog:get', guarded((publicId: unknown) => getWorkLogByPublicId(id(publicId, 'worklog id'))))

  ipcMain.handle('worklog:byDateRange', guarded((from: string, to: string) => {
    return getWorkLogsByDateRange(from, to)
  }))

  ipcMain.handle('worklog:search', guarded((keyword: string, tagPath?: string, projectPublicId?: string) => {
    return searchWorkLogs(keyword, undefined, tagPath, projectPublicId)
  }))

  ipcMain.handle('worklog:categories', guarded(() => {
    return getCategories()
  }))

  ipcMain.handle('worklog:setCategory', guarded((id: number, category: string) => {
    updateWorkLogCategory(id, category)
  }))

  ipcMain.handle('worklog:update', guarded((id: unknown, content: unknown, category: unknown, created_at?: unknown, associations?: unknown) => {
    const input = parseWorkLogUpdateArgs({ id, content, category, created_at, associations })
    return updateWorkLog(input.id, input.content, input.category, input.created_at, input.associations)
  }))

  ipcMain.handle('worklog:delete', guarded((id: number) => {
    return deleteWorkLog(id)
  }))

  ipcMain.handle(
    'worklog:restore',
    guarded((log: { content: string; category: string; created_at: string; task_id: number | null; project_id: string | null; tag_names: string[]; id?: number; public_id?: string }) => {
      return restoreWorkLog(log)
    })
  )

  ipcMain.handle('stats:get', guarded((days?: unknown) => getStats(parseStatsDays(days))))

  // --- Reports ---

  ipcMain.handle('report:generate', guarded(async (request: unknown) => {
    return services().reports.generate(parseReportRequest(request))
  }))

  ipcMain.handle('report:stream:start', guardedWithEvent(async (event, request: unknown) => {
    const parsed = parseReportRequest(request)
    const requestId = randomUUID()
    const controller = new AbortController()
    const sender = event.sender
    reportStreams.set(requestId, { controller, senderId: sender.id, sender })
    setTimeout(() => {
      void services().reports.generate(parsed, {
        signal: controller.signal,
        onStage: (stage) => sendReportStreamEvent(sender, { request_id: requestId, type: 'stage', stage }),
        onChunk: (chunk) => sendReportStreamEvent(sender, { request_id: requestId, type: 'chunk', chunk })
      }).then((report) => {
        sendReportStreamEvent(sender, { request_id: requestId, type: 'done', report })
      }).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'AI report generation failed'
        sendReportStreamEvent(sender, {
          request_id: requestId,
          type: 'error',
          code: controller.signal.aborted ? 'cancelled' : 'failed',
          message
        })
      }).finally(() => {
        reportStreams.delete(requestId)
      })
    }, 0)
    return requestId
  }))

  ipcMain.handle('report:stream:cancel', guardedWithEvent((event, requestId: unknown) => {
    if (typeof requestId !== 'string') return
    const stream = reportStreams.get(requestId)
    if (stream && stream.senderId === event.sender.id) stream.controller.abort()
  }))

  ipcMain.handle('report:preview', guarded((request: unknown) => {
    return services().reports.preview(parseReportRequest(request))
  }))

  ipcMain.handle('report:list', guarded((pagination?: unknown) => {
    const value = parseReportListInput(pagination)
    return services().reports.list(value.limit)
  }))

  ipcMain.handle('report:get', guarded((publicId: unknown) => services().reports.get(id(publicId, 'report id'))))

  ipcMain.handle('report:update', guarded((publicId: unknown, input: unknown) => {
    const value = input && typeof input === 'object' && !Array.isArray(input) ? input as { content?: unknown } : null
    if (!value || Object.keys(value).some((key) => key !== 'content') || typeof value.content !== 'string' || !value.content.trim()) {
      throw new IpcContractError('INVALID_ARGUMENT', 'Report content is required')
    }
    return services().reports.updateContent(id(publicId, 'report id'), value.content)
  }))

  ipcMain.handle('ai:testConnection', guarded((input: unknown) => {
    const value = parseAiConnectionTestInput(input)
    return testAiConnection({
      provider: value.provider,
      apiKey: value.api_key,
      baseUrl: value.base_url,
      model: value.model
    })
  }))

  // --- Project / inbox / tag / search / repository domain APIs ---

  ipcMain.handle('project:list', guarded((pagination?: unknown) => services().projects.list(parsePagination(pagination))))
  ipcMain.handle('project:activity', guarded((publicId: unknown) => services().projects.activity(id(publicId, 'project id'))))
  ipcMain.handle('project:create', guarded((input: unknown) => {
    const project = parseProjectInput(input)
    return services().projects.create({ name: project.name!, description: project.description ?? '', color: project.color ?? '#64748b' })
  }))
  ipcMain.handle('project:update', guarded((publicId: unknown, input: unknown) => services().projects.update(id(publicId, 'project id'), parseProjectInput(input, true))))
  ipcMain.handle('project:archive', guarded((publicId: unknown) => services().projects.softDelete(id(publicId, 'project id'))))

  ipcMain.handle('inbox:list', guarded((pagination?: unknown) => services().inbox.list(parseInboxListInput(pagination))))
  ipcMain.handle('inbox:get', guarded((publicId: unknown) => services().inbox.get(id(publicId, 'inbox id'))))
  ipcMain.handle('inbox:create', guarded((input: unknown) => {
    const item = parseInboxInput(input)
    if (!item.content) throw new IpcContractError('INVALID_ARGUMENT', 'Inbox content is required')
    return services().inbox.create({ ...item, content: item.content! })
  }))
  ipcMain.handle('inbox:update', guarded((publicId: unknown, input: unknown) => services().inbox.update(id(publicId, 'inbox id'), parseInboxInput(input))))
  ipcMain.handle('inbox:organize', guarded((publicId: unknown) => services().inbox.confirm(id(publicId, 'inbox id'))))
  ipcMain.handle('inbox:ignore', guarded((publicId: unknown) => services().inbox.ignore(id(publicId, 'inbox id'))))
  ipcMain.handle('inbox:archive', guarded((publicId: unknown) => services().inbox.archive(id(publicId, 'inbox id'))))
  ipcMain.handle('inbox:delete', guarded((publicId: unknown) => services().inbox.softDelete(id(publicId, 'inbox id'))))
  ipcMain.handle('inbox:ai-organize', guarded(async (input: unknown) => {
    const request = parseInboxAiInput(input)
    const domain = services()
    const candidates = domain.inbox.listUnorganized(request.limit, request.public_ids)
    const references = {
      projects: domain.projects.list({ limit: 200, offset: 0 }).items.map((project) => ({ public_id: project.public_id, name: project.name })),
      tags: domain.tags.list({ limit: 200, offset: 0 }).items.map((tag) => tag.path)
    }
    const items = []
    let failed = 0
    for (const candidate of candidates) {
      try {
        const suggestion = await withTimeout((signal) => generateInboxSuggestion(candidate.content, references, signal), INBOX_AI_TIMEOUT_MS)
        const updated = domain.inbox.update(candidate.public_id, { ai_suggestion: suggestion })
        if (updated) items.push(updated)
      } catch (error) {
        failed++
        const message = error instanceof Error ? error.message : String(error)
        console.warn('Inbox AI organization failed', { publicId: candidate.public_id, message })
      }
    }
    return { processed: candidates.length, updated: items.length, failed, items }
  }))

  ipcMain.handle('tag:list', guarded((pagination?: unknown) => services().tags.list(parsePagination(pagination))))
  ipcMain.handle('tag:create', guarded((name: unknown) => {
    if (typeof name !== 'string' || !name.trim()) throw new IpcContractError('INVALID_ARGUMENT', 'Tag name is required')
    return services().tags.create(name)
  }))
  ipcMain.handle('tag:rename', guarded((publicId: unknown, name: unknown) => {
    if (typeof name !== 'string' || !name.trim()) throw new IpcContractError('INVALID_ARGUMENT', 'Tag name is required')
    return services().tags.rename(id(publicId, 'tag id'), name)
  }))
  ipcMain.handle('tag:search', guarded((query: unknown, pagination?: unknown) => {
    if (typeof query !== 'string' || query.length > 200) throw new IpcContractError('INVALID_ARGUMENT', 'Tag query is invalid')
    return services().tags.search(query, parsePagination(pagination))
  }))

  ipcMain.handle('search:query', guarded((input: unknown) => services().search.search(parseSearchQueryInput(input))))

  ipcMain.handle('repository:list', guarded((pagination?: unknown) => services().repositories.list(parsePagination(pagination))))
  ipcMain.handle('repository:get', guarded((publicId: unknown) => services().repositories.get(id(publicId, 'repository id'))))
  ipcMain.handle('repository:create', guarded((input: unknown) => services().repositories.create(parseRepositoryCreateInput(input))))
  ipcMain.handle('repository:update', guarded((publicId: unknown, input: unknown) => {
    const value = parseRepositoryUpdateInput(input)
    return services().repositories.update(id(publicId, 'repository id'), value)
  }))
  ipcMain.handle('repository:delete', guarded((publicId: unknown) => services().repositories.softDelete(id(publicId, 'repository id'))))
  ipcMain.handle('repository:scan', guarded((publicId: unknown) => services().repositories.scanOne(id(publicId, 'repository id'))))
  ipcMain.handle('repository:scanAll', guarded(async () => {
    const results = await services().repositories.scanAllEnabled()
    return {
      succeeded: results.filter((result) => result.status === 'succeeded').length,
      failed: results.filter((result) => result.status === 'failed').length,
      commits: results.reduce((total, result) => total + result.inserted_count, 0),
      errors: results.filter((result) => result.status === 'failed').map((result) => ({ repository_id: result.repository_id, error: result.error ?? '' })),
      results
    }
  }))

  // --- Local database transfer ---

  ipcMain.handle('database:export', guarded(async () => {
    const result = await dialog.showSaveDialog({
      title: tMain('exportDatabaseTitle'),
      defaultPath: 'workpulse-data.json',
      filters: [{ name: tMain('databasePackageFilter'), extensions: ['json'] }]
    })
    if (result.canceled || !result.filePath) return null
    const database = getDatabase()
    const payload = createDatabaseExport(database, getDefaultWorkspaceContext())
    writeFileSync(result.filePath, JSON.stringify(payload), 'utf8')
    return { filePath: result.filePath, preview: previewDatabaseImport(payload) }
  }))

  ipcMain.handle('database:archive-export', guarded(async () => {
    const result = await dialog.showSaveDialog({
      title: tMain('exportDatabaseArchiveTitle'),
      defaultPath: 'workpulse-archive.zip',
      filters: [{ name: tMain('databaseArchiveFilter'), extensions: ['zip'] }]
    })
    if (result.canceled || !result.filePath) return null
    const backup = await createWorkspaceBackup(
      getDatabase(),
      getDefaultWorkspaceContext(),
      join(app.getPath('userData'), 'attachments'),
      result.filePath
    )
    const payload = JSON.parse(readAttachmentArchive(readFileSync(backup.filePath)).find((entry) => entry.name === 'data.json')!.data.toString('utf8'))
    return { filePath: backup.filePath, preview: previewDatabaseImport(payload), attachments: backup.attachments }
  }))

  ipcMain.handle('database:import', guardedWithEvent(async (event, request: unknown) => {
    const action = request && typeof request === 'object' && !Array.isArray(request) ? request as Record<string, unknown> : null
    if (!action || Object.keys(action).some((key) => !['action', 'token'].includes(key)) || (action.action !== 'preview' && action.action !== 'merge')) {
      throw new IpcContractError('INVALID_ARGUMENT', 'Import request is invalid')
    }
    if (action.action === 'preview') {
      const result = await dialog.showOpenDialog({
        title: tMain('importDatabaseTitle'),
        filters: [{ name: tMain('databasePackageFilter'), extensions: ['json'] }],
        properties: ['openFile']
      })
      if (result.canceled || !result.filePaths[0]) return null
      const filePath = result.filePaths[0]
      if (statSync(filePath).size > MAX_IMPORT_BYTES) throw new IpcContractError('IMPORT_TOO_LARGE', 'Data package is too large')
      let payload: unknown
      try {
        payload = JSON.parse(readFileSync(filePath, 'utf8'))
      } catch {
        throw new IpcContractError('IMPORT_INVALID', 'Invalid data package')
      }
      const preview = previewDatabaseImport(payload)
      const token = pendingImports.put(payload, String(event.sender.id))
      return { token, preview }
    }
    if (typeof action.token !== 'string') throw new IpcContractError('IMPORT_NOT_READY', 'Import preview is required')
    const payload = pendingImports.take(action.token, String(event.sender.id))
    return mergeDatabaseImport(getDatabase(), getDefaultWorkspaceContext(), payload)
  }))

  ipcMain.handle('database:archive-import', guardedWithEvent(async (event, request: unknown) => {
    const action = request && typeof request === 'object' && !Array.isArray(request) ? request as Record<string, unknown> : null
    if (!action || Object.keys(action).some((key) => !['action', 'token'].includes(key)) || (action.action !== 'preview' && action.action !== 'merge')) {
      throw new IpcContractError('INVALID_ARGUMENT', 'Archive import request is invalid')
    }
    if (action.action === 'preview') {
      const result = await dialog.showOpenDialog({
        title: tMain('importDatabaseArchiveTitle'),
        filters: [{ name: tMain('databaseArchiveFilter'), extensions: ['zip'] }],
        properties: ['openFile']
      })
      if (result.canceled || !result.filePaths[0]) return null
      const filePath = result.filePaths[0]
      if (statSync(filePath).size > MAX_ARCHIVE_BYTES) throw new IpcContractError('IMPORT_TOO_LARGE', 'Archive is too large')
      const entries = readAttachmentArchive(readFileSync(filePath))
      let payload: unknown
      try { payload = JSON.parse(entries.find((entry) => entry.name === 'data.json')!.data.toString('utf8')) } catch { throw new IpcContractError('IMPORT_INVALID', 'Invalid archive data') }
      const preview = previewDatabaseImport(payload)
      const token = pendingArchiveImports.put({ entries, payload }, String(event.sender.id))
      return { token, preview, attachments: entries.filter((entry) => entry.name.startsWith('attachments/')).length }
    }
    if (typeof action.token !== 'string') throw new IpcContractError('IMPORT_NOT_READY', 'Archive preview is required')
    const stored = pendingArchiveImports.take(action.token, String(event.sender.id))
    if (!stored) throw new IpcContractError('IMPORT_NOT_READY', 'Archive preview expired')
    const { entries, payload } = stored
    const attachmentRoot = join(app.getPath('userData'), 'attachments')
    mkdirSync(attachmentRoot, { recursive: true })
    const createdAttachments: string[] = []
    try {
      for (const entry of entries.filter((candidate) => candidate.name.startsWith('attachments/'))) {
        const name = entry.name.slice('attachments/'.length)
        const target = join(attachmentRoot, name)
        try {
          writeFileSync(target, entry.data, { flag: 'wx' })
          createdAttachments.push(target)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        }
      }
      return mergeDatabaseImport(getDatabase(), getDefaultWorkspaceContext(), payload)
    } catch (error) {
      for (const path of createdAttachments) {
        try { unlinkSync(path) } catch { /* Best effort rollback of this import's new files. */ }
      }
      throw error
    }
  }))

  ipcMain.handle('database:clear', guarded(async () => {
    const attachmentRoot = join(app.getPath('userData'), 'attachments')
    const result = await clearWorkspaceData(async (database) => {
      const backupPath = join(
        app.getPath('userData'),
        'backups',
        `workpulse-workspace-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.zip`
      )
      return (await createWorkspaceBackup(database, getDefaultWorkspaceContext(), attachmentRoot, backupPath)).filePath
    }, () => stageAttachmentsForClear(attachmentRoot))
    return result
  }))

  ipcMain.handle('attachment:save', guarded((input: unknown) => {
    const value = parseAttachmentInput(input)
    return saveAttachment(join(app.getPath('userData'), 'attachments'), value)
  }))

  // --- Tasks ---

  ipcMain.handle('task:add', guarded((title: unknown, description?: unknown, status?: unknown, createdAt?: unknown, associations?: unknown, priority?: unknown, dueDate?: unknown, checklist?: unknown) => {
    const input = parseTaskCreateArgs({ title, description, status, createdAt, associations, priority, dueDate, checklist })
    return addTask(input.title, input.description, input.status, input.createdAt, input.associations, input.priority, input.dueDate, input.checklist)
  }))

  ipcMain.handle('task:list', guarded(() => {
    return getTasks()
  }))

  ipcMain.handle('task:get', guarded((publicId: unknown) => getTaskByPublicId(id(publicId, 'task id'))))

  ipcMain.handle(
    'task:update',
    guarded((id: unknown, updates: unknown) => {
      const input = parseTaskUpdateArgs({ id, updates })
      return updateTask(input.id, input.updates)
    })
  )

  ipcMain.handle('task:delete', guarded((id: number) => {
    return deleteTask(id)
  }))

  ipcMain.handle('task:restore', guarded((id: number) => {
    return restoreTask(id)
  }))

  ipcMain.handle('task:reorder', guarded((taskIds: unknown, boardColumn: unknown, status?: unknown, sourceBoardColumn?: unknown, sourceTaskIds?: unknown, sourceStatus?: unknown) => {
    const input = parseTaskReorderArgs({ taskIds, boardColumn, status, sourceBoardColumn, sourceTaskIds, sourceStatus })
    reorderTasks(input.taskIds, input.boardColumn, input.status, input.sourceBoardColumn, input.sourceTaskIds, input.sourceStatus)
  }))

  ipcMain.handle('kanban:columns:list', guarded((): KanbanColumn[] => getKanbanColumns()))
  ipcMain.handle('kanban:columns:create', guarded((name: string): KanbanColumn => createKanbanColumn(name)))
  ipcMain.handle('kanban:columns:update', guarded((publicId: string, name: string): KanbanColumn | null => updateKanbanColumn(publicId, name)))
  ipcMain.handle('kanban:columns:delete', guarded((publicId: string): boolean => deleteKanbanColumn(publicId)))

  // Complete task + auto create work log
  ipcMain.handle('task:complete', guarded((id: number, logContent: string) => completeTask(id, logContent)))

  ipcMain.handle('task:completeOnly', guarded((id: number) => {
    return updateTask(id, { status: 'done' })
  }))

  // --- Settings ---

  ipcMain.handle('settings:get', guarded((key: string) => {
    if (key === 'api_key') {
      return getStoredApiKey()
    }
    return getSetting(key)
  }))

  ipcMain.handle('settings:set', guarded((key: unknown, value: unknown) => {
    const input = parseSettingUpdateArgs({ key, value })
    if (input.key === 'api_key') {
      setStoredApiKey(input.value)
      return
    }
    setSetting(input.key, input.value)
  }))

  ipcMain.handle('settings:delete', guarded((key: string) => {
    if (key === 'api_key') {
      deleteStoredApiKey()
      return
    }
    deleteSetting(key)
  }))

  // --- Export ---

  ipcMain.handle('export:logs', guarded(async (format: 'csv' | 'markdown') => {
    const ext = format === 'csv' ? 'csv' : 'md'
    const result = await dialog.showSaveDialog({
      title: tMain('exportLogsTitle'),
      defaultPath: `workpulse-logs.${ext}`,
      filters: [
        format === 'csv'
          ? { name: 'CSV', extensions: ['csv'] }
          : { name: 'Markdown', extensions: ['md'] }
      ]
    })

    if (result.canceled || !result.filePath) return null

    const logs = getAllWorkLogs()
    if (logs.length === 0) throw new Error(tMain('noLogsToExport'))

    let content: string
    if (format === 'csv') {
      const escapeCsvCell = (value: string): string => `"${value.replace(/"/g, '""')}"`
      const header = tMain('csvHeader')
      const rows = logs
        .map((l) => [l.created_at, l.category, l.content].map(escapeCsvCell).join(','))
        .join('\n')
      content = header + rows
    } else {
      const grouped = new Map<string, typeof logs>()
      for (const log of logs) {
        const date = log.created_at.slice(0, 10)
        const list = grouped.get(date) || []
        list.push(log)
        grouped.set(date, list)
      }
      const sections = Array.from(grouped.entries()).map(([date, dateLogs]) => {
        const items = dateLogs.map((l) => {
          const category = l.category ? ` [${l.category}]` : ''
          return `- ${l.created_at.slice(11, 16)}${category} ${l.content}`
        }).join('\n')
        return `## ${date}\n\n${items}`
      })
      content = `${tMain('markdownLogsTitle')}\n\n${sections.join('\n\n')}\n`
    }

    writeFileSync(result.filePath, content, 'utf-8')
    return result.filePath
  }))

  ipcMain.handle('export:report', guarded(async (reportContent: string, dateRange: string) => {
    const defaultPath = dateRange.startsWith('workpulse-')
      ? `${dateRange}.md`
      : `workpulse-report-${dateRange}.md`
    const result = await dialog.showSaveDialog({
      title: tMain('exportReportTitle'),
      defaultPath,
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    })

    if (result.canceled || !result.filePath) return null

    writeFileSync(result.filePath, reportContent, 'utf-8')
    return result.filePath
  }))

  // --- Import ---

  ipcMain.handle('import:logs', guarded(async () => {
    const result = await dialog.showOpenDialog({
      title: '导入工作日志',
      filters: [
        { name: 'CSV / Markdown / Flomo HTML', extensions: ['csv', 'md', 'html', 'htm'] }
      ],
      properties: ['openFile']
    })

    if (result.canceled || result.filePaths.length === 0) return null

    const filePath = result.filePaths[0]
    assertImportFileSize(statSync(filePath).size)
    const content = readFileSync(filePath, 'utf-8')
    const lowerFilePath = filePath.toLowerCase()
    const ext = lowerFilePath.endsWith('.csv')
      ? 'csv'
      : lowerFilePath.endsWith('.html') || lowerFilePath.endsWith('.htm')
        ? 'html'
        : 'md'

    if (ext === 'html') {
      const parsed = parseFlomoHtml(content)
      if (parsed.memos.length === 0) throw new Error('未找到有效的 Flomo HTML 笔记')
      const summary = importFlomoMemos(parsed.memos, { addWorkLog, addWorkLogsBatch, workLogExists, listWorkLogs: getAllWorkLogs }, {
        sourceRoot: dirname(filePath),
        attachmentRoot: join(app.getPath('userData'), 'attachments'),
        saveAttachment
      })
      return {
        ...summary,
        filePath,
        source: 'flomo' as const
      }
    }

    let imported = 0
    let skipped = 0
    const batch: Array<{ content: string; category: string; taskId: null; createdAt?: string }> = []
    const pendingKeys = new Set(getAllWorkLogs().map((log) => buildImportKey(log.content, log.category, log.created_at)))
    const queueIfNew = (content: string, category: string, createdAt?: string): void => {
      const key = buildImportKey(content, category, createdAt)
      if (!content || pendingKeys.has(key)) {
        skipped++
        return
      }
      pendingKeys.add(key)
      batch.push({ content, category, taskId: null, createdAt })
      imported++
    }
    if (ext === 'csv') {
      const lines = content.split('\n').filter((line) => line.trim())
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim()
        if (!line) continue
        const parts = parseCSVLine(line)
        if (parts.length >= 3) {
          const [time, category, logContent] = parts
          const cat = category || ''
          queueIfNew(logContent, cat, time || undefined)
        }
      }
    } else {
      const sections = content.split('\n## ')
      for (const section of sections) {
        const lines = section.split('\n')
        let dateStr = ''
        const headerLine = lines[0].replace(/^#+\s*/, '').trim()
        if (/^\d{4}-\d{2}-\d{2}$/.test(headerLine)) {
          dateStr = headerLine
        }
        for (const line of lines) {
          const match = line.match(/^-\s*(\d{2}:\d{2}(:\d{2})?)\s*(?:\[([^\]]+)\]\s*)?(.+)$/)
          if (match) {
            const time = match[1]
            const category = match[3] || ''
            const logContent = match[4].trim()
            const createdAt = dateStr ? `${dateStr} ${time}` : undefined
            const cat = category
            queueIfNew(logContent, cat, createdAt || undefined)
          }
        }
      }
    }

    addWorkLogsBatch(batch)
    return { imported, skipped, filePath, source: 'file' as const, attachmentsImported: 0, attachmentsSkipped: 0 }
  }))

  // --- App ---

  ipcMain.handle('app:open-backup-dir', guarded(async () => {
    const backupDir = join(app.getPath('userData'), 'backups')
    return shell.openPath(backupDir)
  }))
}

function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        current += ch
      }
    } else {
      if (ch === '"') {
        inQuotes = true
      } else if (ch === ',') {
        result.push(current)
        current = ''
      } else {
        current += ch
      }
    }
  }
  result.push(current)
  return result
}

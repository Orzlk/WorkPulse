import { ipcMain, dialog, app, shell } from 'electron'
import { writeFileSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import {
  addWorkLog,
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
  addTask,
  getTasks,
  getTaskByPublicId,
  updateTask,
  deleteTask,
  reorderTasks,
  workLogExists,
  type Task
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
import {
  IpcContractError,
  id,
  parseInboxInput,
  parsePagination,
  parseProjectInput,
  parseReportListInput,
  parseReportRequest,
  parseRepositoryCreateInput,
  parseSearchQueryInput,
  parseWorkItemAssociations,
  toIpcContractError
} from './ipcContracts'
import { createDatabaseExport, mergeDatabaseImport, previewDatabaseImport } from './database/transfer'
import { ImportTokenStore } from './database/importTokenStore'

const MAX_IMPORT_BYTES = 20 * 1024 * 1024
const pendingImports = new ImportTokenStore<unknown>(10 * 60 * 1000)

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

  ipcMain.handle('worklog:add', (_event, content: string, category?: string, associations?: unknown) => {
    return addWorkLog(content, category, null, undefined, parseWorkItemAssociations(associations))
  })

  ipcMain.handle('worklog:list', (_event, limit?: number, offset?: number) => {
    return getWorkLogs(limit, offset)
  })

  ipcMain.handle('worklog:get', guarded((publicId: unknown) => getWorkLogByPublicId(id(publicId, 'worklog id'))))

  ipcMain.handle('worklog:byDateRange', (_event, from: string, to: string) => {
    return getWorkLogsByDateRange(from, to)
  })

  ipcMain.handle('worklog:search', (_event, keyword: string) => {
    return searchWorkLogs(keyword)
  })

  ipcMain.handle('worklog:categories', () => {
    return getCategories()
  })

  ipcMain.handle('worklog:setCategory', (_event, id: number, category: string) => {
    updateWorkLogCategory(id, category)
  })

  ipcMain.handle('worklog:update', (_event, id: number, content: string, category: string, created_at?: string, associations?: unknown) => {
    return updateWorkLog(id, content, category, created_at, parseWorkItemAssociations(associations))
  })

  ipcMain.handle('worklog:delete', (_event, id: number) => {
    return deleteWorkLog(id)
  })

  ipcMain.handle(
    'worklog:restore',
    (_event, log: { content: string; category: string; created_at: string; task_id: number | null }) => {
      return restoreWorkLog(log)
    }
  )

  ipcMain.handle('stats:get', (_event, days?: number) => {
    return getStats(days)
  })

  // --- Reports ---

  ipcMain.handle('report:generate', guarded(async (request: unknown) => {
    return services().reports.generate(parseReportRequest(request))
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

  // --- Project / inbox / tag / search / repository domain APIs ---

  ipcMain.handle('project:list', guarded((pagination?: unknown) => services().projects.list(parsePagination(pagination))))
  ipcMain.handle('project:create', guarded((input: unknown) => {
    const project = parseProjectInput(input)
    return services().projects.create({ name: project.name!, description: project.description ?? '', color: project.color ?? '#64748b' })
  }))
  ipcMain.handle('project:update', guarded((publicId: unknown, input: unknown) => services().projects.update(id(publicId, 'project id'), parseProjectInput(input, true))))
  ipcMain.handle('project:archive', guarded((publicId: unknown) => services().projects.softDelete(id(publicId, 'project id'))))

  ipcMain.handle('inbox:list', guarded((pagination?: unknown) => services().inbox.list(parsePagination(pagination))))
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
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new IpcContractError('INVALID_ARGUMENT', 'Repository update is invalid')
    const value = input as Record<string, unknown>
    if (Object.keys(value).some((key) => !['project_id', 'enabled'].includes(key))) throw new IpcContractError('INVALID_ARGUMENT', 'Unknown repository field')
    if (value.project_id !== undefined && value.project_id !== null) id(value.project_id, 'project id')
    if (value.enabled !== undefined && typeof value.enabled !== 'boolean') throw new IpcContractError('INVALID_ARGUMENT', 'enabled must be a boolean')
    return services().repositories.update(id(publicId, 'repository id'), value as { project_id?: string | null; enabled?: boolean })
  }))
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

  // --- Tasks ---

  ipcMain.handle('task:add', (_event, title: string, description?: string, status?: 'todo' | 'draft', createdAt?: string, associations?: unknown) => {
    return addTask(title, description, status, createdAt, parseWorkItemAssociations(associations))
  })

  ipcMain.handle('task:list', () => {
    return getTasks()
  })

  ipcMain.handle('task:get', guarded((publicId: unknown) => getTaskByPublicId(id(publicId, 'task id'))))

  ipcMain.handle(
    'task:update',
    (
      _event,
      id: number,
      updates: Partial<Pick<Task, 'title' | 'description' | 'status' | 'position' | 'due_date' | 'project_id' | 'repository_id' | 'tag_names'>>
    ) => {
      return updateTask(id, { ...updates, ...parseWorkItemAssociations({ project_id: updates.project_id, repository_id: updates.repository_id, tag_names: updates.tag_names }) })
    }
  )

  ipcMain.handle('task:delete', (_event, id: number) => {
    return deleteTask(id)
  })

  ipcMain.handle('task:reorder', (_event, taskIds: number[], status: string) => {
    reorderTasks(taskIds, status)
  })

  // Complete task + auto create work log
  ipcMain.handle(
    'task:complete',
    (_event, id: number, logContent: string) => {
      const task = updateTask(id, { status: 'done' })
      if (task && logContent.trim()) {
        addWorkLog(logContent.trim(), '', id)
      }
      return task
    }
  )

  ipcMain.handle('task:completeOnly', (_event, id: number) => {
    return updateTask(id, { status: 'done' })
  })

  // --- Settings ---

  ipcMain.handle('settings:get', (_event, key: string) => {
    if (key === 'api_key') {
      return getStoredApiKey()
    }
    return getSetting(key)
  })

  ipcMain.handle('settings:set', (_event, key: string, value: string) => {
    if (key === 'api_key') {
      setStoredApiKey(value)
      return
    }
    setSetting(key, value)
  })

  ipcMain.handle('settings:delete', (_event, key: string) => {
    if (key === 'api_key') {
      deleteStoredApiKey()
      return
    }
    deleteSetting(key)
  })

  // --- Export ---

  ipcMain.handle('export:logs', async (_event, format: 'csv' | 'markdown') => {
    const logs = getAllWorkLogs()
    if (logs.length === 0) throw new Error(tMain('noLogsToExport'))

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
  })

  ipcMain.handle('export:report', async (_event, reportContent: string, dateRange: string) => {
    const result = await dialog.showSaveDialog({
      title: tMain('exportReportTitle'),
      defaultPath: `workpulse-report-${dateRange}.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    })

    if (result.canceled || !result.filePath) return null

    writeFileSync(result.filePath, reportContent, 'utf-8')
    return result.filePath
  })

  // --- Import ---

  ipcMain.handle('import:logs', async (_event) => {
    const result = await dialog.showOpenDialog({
      title: '导入工作日志',
      filters: [
        { name: 'CSV / Markdown', extensions: ['csv', 'md'] }
      ],
      properties: ['openFile']
    })

    if (result.canceled || result.filePaths.length === 0) return null

    const filePath = result.filePaths[0]
    const content = readFileSync(filePath, 'utf-8')
    const ext = filePath.toLowerCase().endsWith('.csv') ? 'csv' : 'md'

    let imported = 0
    let skipped = 0
    if (ext === 'csv') {
      const lines = content.split('\n').filter((line) => line.trim())
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim()
        if (!line) continue
        const parts = parseCSVLine(line)
        if (parts.length >= 3) {
          const [time, category, logContent] = parts
          const cat = category || ''
          if (logContent && !workLogExists(logContent, cat, time || undefined)) {
            addWorkLog(logContent, cat, null, time || undefined)
            imported++
          } else {
            skipped++
          }
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
            if (logContent && !workLogExists(logContent, cat, createdAt || undefined)) {
              addWorkLog(logContent, cat, null, createdAt)
              imported++
            } else {
              skipped++
            }
          }
        }
      }
    }

    return { imported, skipped, filePath }
  })

  // --- App ---

  ipcMain.handle('app:open-backup-dir', async () => {
    const backupDir = join(app.getPath('userData'), 'backups')
    return shell.openPath(backupDir)
  })
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

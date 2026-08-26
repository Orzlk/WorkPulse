import { ipcMain, dialog, app, shell } from 'electron'
import { writeFileSync, readFileSync } from 'fs'
import { join } from 'path'
import {
  addWorkLog,
  getWorkLogs,
  getWorkLogsByDateRange,
  searchWorkLogs,
  getAllWorkLogs,
  getStats,
  getCategories,
  updateWorkLogCategory,
  updateWorkLog,
  deleteWorkLog,
  restoreWorkLog,
  saveReport,
  getReports,
  updateReportContent,
  getSetting,
  setSetting,
  deleteSetting,
  addTask,
  getTasks,
  updateTask,
  deleteTask,
  reorderTasks,
  workLogExists,
  type Task
} from './db'
import { generateReport } from './ai'
import { deleteStoredApiKey, getStoredApiKey, setStoredApiKey } from './secureSettings'
import { tMain } from './i18n'

export function registerIpcHandlers(): void {
  // --- Work Logs ---

  ipcMain.handle('worklog:add', (_event, content: string, category?: string) => {
    return addWorkLog(content, category)
  })

  ipcMain.handle('worklog:list', (_event, limit?: number, offset?: number) => {
    return getWorkLogs(limit, offset)
  })

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

  ipcMain.handle('worklog:update', (_event, id: number, content: string, category: string, created_at?: string) => {
    return updateWorkLog(id, content, category, created_at)
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

  ipcMain.handle(
    'report:generate',
    async (_event, dateFrom: string, dateTo: string) => {
      const logs = getWorkLogsByDateRange(dateFrom, dateTo)
      if (logs.length === 0) {
        throw new Error(tMain('noWorkLogsInRange'))
      }
      const tasks = getTasks().filter((task) => {
        if (task.status !== 'done') return true
        const completedDate = task.completed_at?.slice(0, 10)
        return Boolean(completedDate && completedDate >= dateFrom && completedDate <= dateTo)
      })
      const content = await generateReport(logs, dateFrom, dateTo, tasks)
      const report = saveReport('custom', dateFrom, dateTo, content)
      return report
    }
  )

  ipcMain.handle('report:list', (_event, limit?: number) => {
    return getReports(limit)
  })

  ipcMain.handle('report:update', (_event, id: number, content: string) => {
    return updateReportContent(id, content)
  })

  // --- Tasks ---

  ipcMain.handle('task:add', (_event, title: string, description?: string, status?: 'todo' | 'draft', createdAt?: string) => {
    return addTask(title, description, status, createdAt)
  })

  ipcMain.handle('task:list', () => {
    return getTasks()
  })

  ipcMain.handle(
    'task:update',
    (
      _event,
      id: number,
      updates: Partial<Pick<Task, 'title' | 'description' | 'status' | 'position' | 'due_date'>>
    ) => {
      return updateTask(id, updates)
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

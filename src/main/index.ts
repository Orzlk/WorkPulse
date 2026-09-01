import { app, BrowserWindow, dialog, shell, Menu, Tray, nativeImage, nativeTheme, globalShortcut, ipcMain, net, protocol } from 'electron'
import { join } from 'path'
import { readFileSync } from 'fs'
import { pathToFileURL } from 'node:url'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { getDatabase, getDefaultWorkspaceContext, initDatabase, getSetting, setSetting } from './db'
import { registerIpcHandlers } from './ipc'
import { tMain, type AppLanguage } from './i18n'
import { configureAutoUpdater, registerUpdateIpc, startUpdateCheck } from './updater'
import { RepositoryScheduler, RepositoryService } from './services/repositoryService'
import { buildWorkLogEditorQuery, shouldPromptWorkLogEditorClose } from './workLogEditorWindow'
import { buildTaskCreateQuery, buildTaskCreateTitleBarOverlay, shouldPromptTaskCreateClose } from './taskCreateWindow'
import { readMainWindowSize, saveMainWindowSize } from './windowState'
import { resolveAttachmentPath } from './attachments/attachmentStorage'
import { ReportService } from './reports/reportService'

protocol.registerSchemesAsPrivileged([{
  scheme: 'workpulse-attachment',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
}])

let tray: Tray | null = null
let isQuitting = false
let repositoryScheduler: RepositoryScheduler | null = null
let mainWindowRef: BrowserWindow | null = null
let workLogEditorWindow: BrowserWindow | null = null
let workLogEditorPublicId: string | null = null
let workLogEditorDirty = false
let taskCreateWindow: BrowserWindow | null = null
let taskCreateDirty = false

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection in WorkPulse main process', reason)
})

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception in WorkPulse main process', error)
  if (app.isReady()) {
    dialog.showErrorBox('WorkPulse 发生错误', error instanceof Error ? error.message : String(error))
  }
  app.quit()
})

// --- Helpers ---

function getMainWindow(): BrowserWindow | null {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) return mainWindowRef
  return BrowserWindow.getAllWindows()[0] || null
}

function sendToRenderer(channel: string): void {
  const win = getMainWindow()
  if (win) {
    if (!win.isVisible()) win.show()
    win.focus()
    win.webContents.send(channel)
  }
}

// --- Shortcuts ---

const DEFAULT_SHORTCUT_LOG = 'CmdOrCtrl+Shift+L'
const DEFAULT_SHORTCUT_TASK = 'CmdOrCtrl+Shift+T'

function getShortcuts(overrides: Partial<{ log: string; task: string }> = {}): { log: string; task: string } {
  const log = overrides.log ?? getSetting('shortcut_quick_log') ?? DEFAULT_SHORTCUT_LOG
  const task = overrides.task ?? getSetting('shortcut_quick_task') ?? DEFAULT_SHORTCUT_TASK
  return { log, task }
}

function registerShortcut(accelerator: string, channel: string): boolean {
  try {
    return globalShortcut.register(accelerator, () => sendToRenderer(channel))
  } catch {
    return false
  }
}

function startRepositoryScheduler(): void {
  if (getSetting('git_scan_enabled') === 'false') return
  const configuredInterval = Number(getSetting('git_scan_interval_minutes') ?? '30')
  const intervalMinutes = Number.isFinite(configuredInterval) && configuredInterval > 0 ? configuredInterval : 30
  repositoryScheduler = new RepositoryScheduler(
    new RepositoryService(getDatabase(), getDefaultWorkspaceContext()),
    intervalMinutes * 60 * 1000
  )
  repositoryScheduler.start()
}

function registerAttachmentProtocol(): void {
  protocol.handle('workpulse-attachment', (request) => {
    const filePath = resolveAttachmentPath(join(app.getPath('userData'), 'attachments'), request.url)
    return filePath ? net.fetch(pathToFileURL(filePath).toString()) : new Response('Not found', { status: 404 })
  })
}

export function reregisterGlobalShortcuts(
  overrides: Partial<{ log: string; task: string }> = {}
): { log: boolean; task: boolean } {
  globalShortcut.unregisterAll()
  const { log, task } = getShortcuts(overrides)

  return {
    log: registerShortcut(log, 'quick-create:log'),
    task: registerShortcut(task, 'quick-create:task')
  }
}

// --- Application Menu ---

function buildMenu(): void {
  const isMac = process.platform === 'darwin'
  const { log: logShortcut, task: taskShortcut } = getShortcuts()

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' }
            ]
          }
        ] as Electron.MenuItemConstructorOptions[])
      : []),
    {
      label: tMain('create'),
      submenu: [
        {
          label: tMain('newLog'),
          accelerator: logShortcut,
          click: () => sendToRenderer('quick-create:log')
        },
        {
          label: tMain('newTask'),
          accelerator: taskShortcut,
          click: () => sendToRenderer('quick-create:task')
        }
      ]
    },
    {
      label: tMain('navigation'),
      submenu: [
        { label: tMain('logs'), accelerator: 'CmdOrCtrl+1', click: () => sendToRenderer('navigate:worklog') },
        { label: tMain('inbox'), click: () => sendToRenderer('navigate:inbox') },
        { label: tMain('board'), accelerator: 'CmdOrCtrl+2', click: () => sendToRenderer('navigate:kanban') },
        { label: tMain('projects'), click: () => sendToRenderer('navigate:projects') },
        { label: tMain('repositories'), click: () => sendToRenderer('navigate:repositories') },
        { label: tMain('reports'), accelerator: 'CmdOrCtrl+3', click: () => sendToRenderer('navigate:report') },
        { label: tMain('stats'), accelerator: 'CmdOrCtrl+4', click: () => sendToRenderer('navigate:stats') },
        { type: 'separator' },
        { label: tMain('settings'), accelerator: 'CmdOrCtrl+,', click: () => sendToRenderer('navigate:settings') }
      ]
    },
    {
      label: tMain('edit'),
      submenu: [
        { role: 'undo' }, { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }
      ]
    },
    {
      label: tMain('window'),
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac
          ? ([{ type: 'separator' }, { role: 'front' }] as Electron.MenuItemConstructorOptions[])
          : ([{ role: 'close' }] as Electron.MenuItemConstructorOptions[]))
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// --- Tray ---

function buildTrayMenu(): Electron.Menu {
  return Menu.buildFromTemplate([
    {
      label: tMain('newLog'),
      click: () => sendToRenderer('quick-create:log')
    },
    {
      label: tMain('newTask'),
      click: () => sendToRenderer('quick-create:task')
    },
    { type: 'separator' },
    {
      label: tMain('showApp'),
      click: () => {
        const win = getMainWindow()
        if (win) { win.show(); win.focus() }
      }
    },
    { type: 'separator' },
    {
      label: tMain('quit'),
      click: () => app.quit()
    }
  ])
}

function createTray(): void {
  // In dev: resources/ is at project root. In production: extraResources copies it to app.getPath('exe')/../
  const iconPath = is.dev
    ? join(__dirname, '../../resources/icon.png')
    : join(process.resourcesPath, 'icon.png')
  let icon = nativeImage.createFromPath(iconPath)
  if (process.platform === 'darwin') {
    try {
      icon = nativeImage.createFromBuffer(readFileSync(iconPath), { scaleFactor: 2 })
    } catch {
      // Fall back to the regular path-loaded image below.
    }
  }
  if (icon.isEmpty()) {
    // Fallback: create a minimal 1x1 white pixel template image
    icon = nativeImage.createFromDataURL(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAABdJREFUeNpj/P//PwMlgHHUgFEDAAIMAAABBgABsp3F1QAAAABJRU5ErkJggg=='
    )
  }
  if (process.platform !== 'darwin') {
    icon = icon.resize({ width: 18, height: 18 })
  }
  icon.setTemplateImage(true)
  tray = new Tray(icon)
  tray.setToolTip('WorkPulse')
  tray.setContextMenu(buildTrayMenu())

  // Click on tray icon shows/focuses the window
  tray.on('click', () => {
    const win = getMainWindow()
    if (win) {
      if (win.isVisible() && win.isFocused()) {
        win.hide()
      } else {
        win.show()
        win.focus()
      }
    }
  })
}

// --- Window ---

function getAppIconPath(): string {
  return is.dev
    ? join(__dirname, '../../resources/icon.png')
    : join(process.resourcesPath, 'icon.png')
}

function createWindow(): void {
  const size = readMainWindowSize(getSetting)
  const mainWindow = new BrowserWindow({
    width: size.width,
    height: size.height,
    minWidth: 400,
    minHeight: 500,
    show: false,
    title: 'WorkPulse',
    autoHideMenuBar: true,
    icon: getAppIconPath(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })
  mainWindowRef = mainWindow

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.on('close', (event) => {
    try {
      const bounds = mainWindow.isMaximized() || mainWindow.isFullScreen()
        ? mainWindow.getNormalBounds()
        : mainWindow.getBounds()
      saveMainWindowSize(setSetting, bounds)
    } catch {
      // Window persistence must not prevent the application from closing.
    }

    if (process.platform !== 'darwin') {
      if (!isQuitting) {
        event.preventDefault()
        mainWindow.hide()
      }
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function createWorkLogEditorWindow(publicId: string, parent: BrowserWindow | null): void {
  if (workLogEditorWindow && !workLogEditorWindow.isDestroyed()) {
    workLogEditorWindow.focus()
    return
  }

  const editorWindow = new BrowserWindow({
    width: 980,
    height: 760,
    minWidth: 680,
    minHeight: 520,
    show: false,
    title: '编辑日志 - WorkPulse',
    parent: parent && !parent.isDestroyed() ? parent : undefined,
    autoHideMenuBar: true,
    icon: getAppIconPath(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  workLogEditorWindow = editorWindow
  workLogEditorPublicId = publicId
  workLogEditorDirty = false

  editorWindow.once('ready-to-show', () => {
    if (!editorWindow.isDestroyed()) {
      editorWindow.show()
      editorWindow.focus()
    }
  })

  editorWindow.on('close', (event) => {
    if (!shouldPromptWorkLogEditorClose(workLogEditorDirty, isQuitting)) return
    const result = dialog.showMessageBoxSync(editorWindow, {
      type: 'warning',
      buttons: [tMain('continueEditing'), tMain('discardChanges')],
      defaultId: 0,
      cancelId: 0,
      title: tMain('unsavedWorkLogTitle'),
      message: tMain('unsavedWorkLogMessage'),
      detail: tMain('unsavedWorkLogDetail')
    })
    if (result === 0) {
      event.preventDefault()
    } else {
      workLogEditorDirty = false
    }
  })

  editorWindow.on('closed', () => {
    if (workLogEditorWindow === editorWindow) {
      workLogEditorWindow = null
      workLogEditorPublicId = null
      workLogEditorDirty = false
    }
  })

  const query = buildWorkLogEditorQuery(publicId)
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    editorWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}${query}`)
  } else {
    editorWindow.loadFile(join(__dirname, '../renderer/index.html'), { search: query })
  }
}

function createTaskCreateWindow(parent: BrowserWindow | null): void {
  if (taskCreateWindow && !taskCreateWindow.isDestroyed()) {
    if (taskCreateWindow.isMinimized()) taskCreateWindow.restore()
    taskCreateWindow.focus()
    return
  }

  const savedTheme = getSetting('theme')
  const isDarkTheme = savedTheme === 'dark' || (savedTheme !== 'light' && nativeTheme.shouldUseDarkColors)

  const editorWindow = new BrowserWindow({
    width: 980,
    height: 760,
    minWidth: 680,
    minHeight: 560,
    show: false,
    title: '新建任务 - WorkPulse',
    parent: parent && !parent.isDestroyed() ? parent : undefined,
    autoHideMenuBar: true,
    icon: getAppIconPath(),
    // Windows/Linux 隐藏原生标题栏，使用系统 overlay 关闭控件；macOS 保留原生标题栏
    ...(process.platform === 'win32' || process.platform === 'linux'
      ? { titleBarStyle: 'hidden' as const, titleBarOverlay: buildTaskCreateTitleBarOverlay(isDarkTheme) }
      : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  taskCreateWindow = editorWindow
  taskCreateDirty = false

  editorWindow.once('ready-to-show', () => {
    if (!editorWindow.isDestroyed()) {
      editorWindow.show()
      editorWindow.focus()
    }
  })

  editorWindow.on('close', (event) => {
    if (!shouldPromptTaskCreateClose(taskCreateDirty, isQuitting)) return
    const result = dialog.showMessageBoxSync(editorWindow, {
      type: 'warning',
      buttons: [tMain('continueEditing'), tMain('discardChanges')],
      defaultId: 0,
      cancelId: 0,
      title: tMain('unsavedTaskCreateTitle'),
      message: tMain('unsavedTaskCreateMessage'),
      detail: tMain('unsavedTaskCreateDetail')
    })
    if (result === 0) {
      event.preventDefault()
    } else {
      taskCreateDirty = false
    }
  })

  editorWindow.on('closed', () => {
    if (taskCreateWindow === editorWindow) {
      taskCreateWindow = null
      taskCreateDirty = false
    }
  })

  const query = buildTaskCreateQuery()
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    editorWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}${query}`)
  } else {
    editorWindow.loadFile(join(__dirname, '../renderer/index.html'), { search: query })
  }
}

function registerWorkLogEditorIpc(): void {
  ipcMain.handle('worklog-editor:open', (event, publicId: string) => {
    if (typeof publicId !== 'string') return false
    const normalizedPublicId = publicId.trim()
    if (!normalizedPublicId) return false
    createWorkLogEditorWindow(normalizedPublicId, BrowserWindow.fromWebContents(event.sender))
    return true
  })

  ipcMain.on('worklog-editor:set-dirty', (event, isDirty: boolean) => {
    const editorWindow = BrowserWindow.fromWebContents(event.sender)
    if (editorWindow === workLogEditorWindow) workLogEditorDirty = isDirty
  })

  ipcMain.on('worklog-editor:changed', (event, publicId: string) => {
    if (BrowserWindow.fromWebContents(event.sender) !== workLogEditorWindow) return
    if (typeof publicId !== 'string' || publicId !== workLogEditorPublicId) return
    getMainWindow()?.webContents.send('worklog-editor:changed', publicId)
  })

  ipcMain.on('worklog-editor:close', (event) => {
    const editorWindow = BrowserWindow.fromWebContents(event.sender)
    if (!editorWindow || editorWindow !== workLogEditorWindow) return
    workLogEditorDirty = false
    editorWindow.close()
  })
}

function registerTaskCreateIpc(): void {
  ipcMain.handle('task-create:open', (event) => {
    createTaskCreateWindow(BrowserWindow.fromWebContents(event.sender))
    return true
  })

  ipcMain.on('task-create:set-dirty', (event, isDirty: boolean) => {
    const editorWindow = BrowserWindow.fromWebContents(event.sender)
    if (editorWindow === taskCreateWindow) taskCreateDirty = isDirty
  })

  ipcMain.on('task-create:changed', (event, publicId: string) => {
    if (BrowserWindow.fromWebContents(event.sender) !== taskCreateWindow) return
    if (typeof publicId !== 'string' || !publicId.trim()) return
    getMainWindow()?.webContents.send('task-create:changed', publicId)
  })

  ipcMain.on('task-create:close', (event, discard = false) => {
    const editorWindow = BrowserWindow.fromWebContents(event.sender)
    if (!editorWindow || editorWindow !== taskCreateWindow) return
    if (discard === true) taskCreateDirty = false
    editorWindow.close()
  })
}

// --- IPC: shortcut update ---

function registerShortcutIpc(): void {
  ipcMain.handle('shortcut:update', (_event, key: 'shortcut_quick_log' | 'shortcut_quick_task', value: string) => {
    const overrides = key === 'shortcut_quick_log' ? { log: value } : { task: value }
    const results = reregisterGlobalShortcuts(overrides)
    const success = results.log && results.task

    if (!success) {
      reregisterGlobalShortcuts()
      return false
    }

    setSetting(key, value)
    buildMenu()
    if (tray) tray.setContextMenu(buildTrayMenu())
    return true
  })

  ipcMain.handle('app:language:update', (_event, language: AppLanguage) => {
    if (!['system', 'zh', 'en'].includes(language)) return
    setSetting('app_language', language)
    buildMenu()
    if (tray) tray.setContextMenu(buildTrayMenu())
  })
}

// --- Bootstrap ---

const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = getMainWindow()
    if (!win) {
      createWindow()
      return
    }
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  })

  app.whenReady().then(async () => {
    electronApp.setAppUserModelId('com.workpulse')

    if (process.platform === 'darwin' && app.dock) {
      app.dock.setIcon(getAppIconPath())
    }

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    await initDatabase()
    new ReportService(getDatabase(), getDefaultWorkspaceContext()).recoverInterruptedGenerations()
    registerAttachmentProtocol()
    startRepositoryScheduler()
    configureAutoUpdater()
    registerIpcHandlers()
    registerWorkLogEditorIpc()
    registerTaskCreateIpc()
    registerShortcutIpc()
    registerUpdateIpc()
    buildMenu()
    createTray()
    createWindow()
    startUpdateCheck()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })

    const results = reregisterGlobalShortcuts()
    if (!results.log || !results.task) {
      console.warn('One or more global shortcuts could not be registered')
    }
  }).catch((error: unknown) => {
    console.error('WorkPulse startup failed', error)
    dialog.showErrorBox('WorkPulse 启动失败', error instanceof Error ? error.message : '数据库初始化失败，请检查数据目录和备份目录。')
    app.quit()
  })

  app.on('before-quit', () => {
    isQuitting = true
  })

  app.on('will-quit', () => {
    repositoryScheduler?.stop()
    globalShortcut.unregisterAll()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })
}

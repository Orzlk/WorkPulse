import { beforeEach, describe, expect, it, vi } from 'vitest'

const { autoUpdaterMock } = vi.hoisted(() => ({
  autoUpdaterMock: {
    setFeedURL: vi.fn(),
    autoDownload: false,
    autoInstallOnAppQuit: false,
    allowPrerelease: false,
    on: vi.fn(),
    checkForUpdates: vi.fn(),
    quitAndInstall: vi.fn()
  }
}))

vi.mock('electron', () => ({
  app: { getVersion: () => '0.0.1' },
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle: vi.fn() }
}))

vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))
vi.mock('electron-updater', () => ({ autoUpdater: autoUpdaterMock }))

import { checkForUpdates, configureAutoUpdater, GITHUB_UPDATE_TARGET, ONLINE_UPDATES_ENABLED, startUpdateCheck } from '../../src/main/updater'

describe('online update availability', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('enables GitHub online updates for the configured repository', async () => {
    expect(ONLINE_UPDATES_ENABLED).toBe(true)

    configureAutoUpdater()
    const state = await checkForUpdates()

    expect(state.status).toBe('idle')
    expect(autoUpdaterMock.setFeedURL).toHaveBeenCalledWith({ provider: 'github', owner: 'Orzlk', repo: 'WorkPulse' })
    expect(autoUpdaterMock.autoDownload).toBe(true)
    expect(autoUpdaterMock.autoInstallOnAppQuit).toBe(true)
    expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1)
  })

  it('points future GitHub updates at the current project repository', () => {
    expect(GITHUB_UPDATE_TARGET).toEqual({ owner: 'Orzlk', repo: 'WorkPulse' })
  })

  it('schedules an automatic online update check when enabled', () => {
    vi.useFakeTimers()
    try {
      startUpdateCheck()
      expect(vi.getTimerCount()).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })
})

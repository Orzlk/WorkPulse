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

import { checkForUpdates, configureAutoUpdater, ONLINE_UPDATES_ENABLED, startUpdateCheck } from '../../src/main/updater'

describe('online update availability', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps GitHub online updates disabled without configuring the updater', async () => {
    expect(ONLINE_UPDATES_ENABLED).toBe(false)

    configureAutoUpdater()
    const state = await checkForUpdates()

    expect(state.status).toBe('idle')
    expect(autoUpdaterMock.setFeedURL).not.toHaveBeenCalled()
    expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled()
  })

  it('does not schedule an automatic online update check while disabled', () => {
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout')

    startUpdateCheck()

    expect(timeoutSpy).not.toHaveBeenCalled()
    timeoutSpy.mockRestore()
  })
})

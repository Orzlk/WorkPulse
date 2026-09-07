import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getVersion: () => '0.0.1' },
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle: vi.fn() }
}))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: true } }))
vi.mock('electron-updater', () => ({ autoUpdater: { on: vi.fn(), setFeedURL: vi.fn(), checkForUpdates: vi.fn() } }))

import { fetchWithTimeout } from '../../src/main/updater'

describe('updater timeout', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('aborts a request that does not settle', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
    })))
    const promise = fetchWithTimeout('https://example.test/release', {}, 100)
    const rejection = expect(promise).rejects.toThrow('UPDATE_CHECK_TIMEOUT')
    await vi.advanceTimersByTimeAsync(100)
    await rejection
  })
})

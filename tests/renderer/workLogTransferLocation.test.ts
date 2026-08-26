import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'

const workLogPage = readFileSync('src/renderer/src/pages/WorkLogPage.tsx', 'utf8')
const settingsPage = readFileSync('src/renderer/src/pages/SettingsPage.tsx', 'utf8')
const transferCardPath = 'src/renderer/src/components/WorkLogTransferCard.tsx'
const transferCard = existsSync(transferCardPath) ? readFileSync(transferCardPath, 'utf8') : ''

describe('笔记数据管理入口', () => {
  it('removes import and export actions from the notes page', () => {
    expect(workLogPage).not.toContain('window.api.import.logs()')
    expect(workLogPage).not.toContain('window.api.export.logs(')
  })

  it('exposes note import and export from settings data management', () => {
    expect(settingsPage).toContain('<WorkLogTransferCard />')
    expect(existsSync(transferCardPath)).toBe(true)
    expect(transferCard).toContain('window.api.import.logs()')
    expect(transferCard).toContain('window.api.export.logs(format)')
    expect(transferCard).toContain("void exportLogs('csv')")
    expect(transferCard).toContain("void exportLogs('markdown')")
  })
})

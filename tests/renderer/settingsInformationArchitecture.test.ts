import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const settingsPage = readFileSync('src/renderer/src/pages/SettingsPage.tsx', 'utf8')
const app = readFileSync('src/renderer/src/App.tsx', 'utf8')
const logoPath = 'src/renderer/src/assets/workpulse-mark.svg'
const databaseTransferCardPath = 'src/renderer/src/components/DatabaseTransferCard.tsx'
const databaseTransferCard = existsSync(databaseTransferCardPath) ? readFileSync(databaseTransferCardPath, 'utf8') : ''
const translations = readFileSync('src/renderer/src/lib/i18n.ts', 'utf8')

describe('设置页信息架构', () => {
  it('provides stable local navigation for the main settings sections', () => {
    expect(settingsPage).toContain('settings-layout')
    expect(settingsPage).toContain('settings-sidebar')
    expect(settingsPage).toContain('id="settings-ai"')
    expect(settingsPage).toContain('id="settings-data"')
    expect(settingsPage).toContain('id="settings-shortcuts"')
    expect(settingsPage).toContain('id="settings-appearance"')
    expect(settingsPage).toContain('id="settings-updates"')
    expect(settingsPage).toContain('settings.aiAndReports')
    expect(settingsPage).toContain('settings.dataManagement')
  })

  it('puts full database transfer behind a preview and merge confirmation', () => {
    expect(settingsPage).toContain('<DatabaseTransferCard />')
    expect(databaseTransferCard).toContain("window.api.database.export()")
    expect(databaseTransferCard).toContain("window.api.database.import({ action: 'preview' })")
    expect(databaseTransferCard).toContain("window.api.database.import({ action: 'merge', token: preview.token })")
    expect(databaseTransferCard).toContain('role="dialog"')
    expect(databaseTransferCard).toContain('settings.databaseImportPreview')
  })

  it('adds labels for the settings sub-navigation and transfer actions', () => {
    expect(translations).toContain("'settings.aiAndReports': 'AI 与报告'")
    expect(translations).toContain("'settings.databaseExported': '完整数据已导出：{{path}}'")
    expect(translations).toContain("'settings.databaseImportPreview': '导入数据预览'")
  })

  it('uses the WorkPulse mark and keeps updates and about in one branded section', () => {
    expect(existsSync(logoPath)).toBe(true)
    expect(app).toContain("from './assets/workpulse-mark.svg'")
    expect(app).not.toContain("from './assets/brand-seal.png'")
    expect(settingsPage).toContain('settings-brand-card')
    expect(settingsPage).toContain('settings-update-card')
    expect(settingsPage).toContain('settings-about-grid')
    expect(translations).toContain("'settings.productTagline': '工作记录 · Git 改动 · AI 汇报'")
  })
})

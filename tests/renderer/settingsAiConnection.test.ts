import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '../..')
const page = readFileSync(resolve(root, 'src/renderer/src/pages/SettingsPage.tsx'), 'utf8')
const i18n = readFileSync(resolve(root, 'src/renderer/src/lib/i18n.ts'), 'utf8')

describe('AI connection test settings UI', () => {
  it('tests the current provider form values through the preload API', () => {
    expect(page).toContain('window.api.ai.testConnection')
    expect(page).toContain('settings.aiTestConnection')
    expect(page).toContain('settings.aiTestSuccess')
    expect(page).toContain('settings.aiTestFailed')
  })

  it('provides Chinese and English connection test labels', () => {
    expect(i18n).toContain("'settings.aiTestConnection'")
    expect(i18n).toContain("'settings.aiTestSuccess'")
    expect(i18n).toContain("'settings.aiTestFailed'")
  })

  it('shows persistence feedback for settings that save on blur', () => {
    expect(page).toContain('settings.saved')
    expect(page).toContain('settings.saveFailed')
    expect(page).toContain('settingsFieldStatus')
  })
})

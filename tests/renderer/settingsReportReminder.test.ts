import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '../..')
const page = readFileSync(resolve(root, 'src/renderer/src/pages/SettingsPage.tsx'), 'utf8')
const styles = readFileSync(resolve(root, 'src/renderer/src/index.css'), 'utf8')
const i18n = readFileSync(resolve(root, 'src/renderer/src/lib/i18n.ts'), 'utf8')

describe('report reminder switch', () => {
  it('uses a stable semantic switch with pending and failure handling', () => {
    expect(page).toContain('className={`settings-switch')
    expect(page).toContain('settings-switch-thumb')
    expect(page).toContain('disabled={savingReportReminder}')
    expect(page).toContain('settings.reportReminderSaveFailed')
    expect(styles).toContain('.settings-switch')
    expect(styles).toContain('.settings-switch.is-on')
    expect(styles).toContain('.settings-switch-thumb')
    expect(i18n).toContain("'settings.reportReminderSaveFailed'")
  })
})

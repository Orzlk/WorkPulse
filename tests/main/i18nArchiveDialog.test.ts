import { describe, expect, it, vi } from 'vitest'

let locale = 'en-US'
vi.mock('electron', () => ({ app: { getLocale: () => locale } }))
vi.mock('../../src/main/db', () => ({ getSetting: () => 'system' }))

import { tMain } from '../../src/main/i18n'

describe('archive dialog translations', () => {
  it('uses localized titles and filters for archive dialogs', () => {
    locale = 'en-US'
    expect(tMain('exportDatabaseArchiveTitle')).toBe('Export WorkPulse archive')
    expect(tMain('importDatabaseArchiveTitle')).toBe('Import WorkPulse archive')
    expect(tMain('databaseArchiveFilter')).toBe('WorkPulse archive')

    locale = 'zh-CN'
    expect(tMain('exportDatabaseArchiveTitle')).toBe('导出 WorkPulse 完整归档')
    expect(tMain('importDatabaseArchiveTitle')).toBe('导入 WorkPulse 完整归档')
    expect(tMain('databaseArchiveFilter')).toBe('WorkPulse 完整归档')
  })
})

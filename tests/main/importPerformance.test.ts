import { describe, expect, it } from 'vitest'
import { assertImportFileSize, buildImportKey } from '../../src/main/importers/flomoLogImport'

describe('log import safeguards', () => {
  it('uses one stable dedupe key for content, category and local date', () => {
    expect(buildImportKey(' same ', 'work', '2026-09-02T08:00:00.000Z')).toBe(buildImportKey(' same ', 'work', '2026-09-02'))
    expect(buildImportKey('same', 'work', '2026-09-01T23:30:00.000Z', 'Asia/Shanghai')).toContain('2026-09-02')
    expect(buildImportKey('same', 'other', '2026-09-02')).not.toBe(buildImportKey('same', 'work', '2026-09-02'))
  })

  it('rejects files over the shared 20MB limit before parsing', () => {
    expect(() => assertImportFileSize(20 * 1024 * 1024 + 1)).toThrow('IMPORT_TOO_LARGE')
    expect(() => assertImportFileSize(20 * 1024 * 1024)).not.toThrow()
  })
})

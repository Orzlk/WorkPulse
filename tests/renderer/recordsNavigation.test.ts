import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string): string => readFileSync(path, 'utf8')
const worklogPage = read('src/renderer/src/pages/WorkLogPage.tsx')
const inboxPage = read('src/renderer/src/pages/InboxPage.tsx')
const styles = read('src/renderer/src/index.css')
const i18n = read('src/renderer/src/lib/i18n.ts')

describe('records navigation consistency', () => {
  it('uses notes and inbox as the only record tabs', () => {
    expect(worklogPage).toContain("id: 'notes', label: t('workspace.notes'), active: true")
    expect(worklogPage).not.toContain("id: 'tags'")
    expect(inboxPage).toContain("id: 'notes', label: t('workspace.notes')")
    expect(inboxPage).toContain("id: 'inbox', label: t('nav.inbox'), active: true")
  })

  it('keeps a shared sidebar shell while showing tag and inbox filters in their own modes', () => {
    expect(worklogPage).toContain('<RecordsSidebar')
    expect(inboxPage).toContain('<RecordsSidebar')
    expect(inboxPage).toContain('inboxFilter')
    expect(inboxPage).toContain('onInboxFilter')
    expect(styles).toContain('.records-layout')
    expect(styles).toContain('.records-sidebar')
    expect(i18n).toContain("'workspace.notes': '笔记'")
  })
})

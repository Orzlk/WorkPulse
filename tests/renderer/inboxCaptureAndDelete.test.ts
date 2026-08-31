import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '../..')
const page = readFileSync(resolve(root, 'src/renderer/src/pages/InboxPage.tsx'), 'utf8')
const store = readFileSync(resolve(root, 'src/renderer/src/stores/inboxStore.ts'), 'utf8')
const service = readFileSync(resolve(root, 'src/main/services/inboxService.ts'), 'utf8')
const ipc = readFileSync(resolve(root, 'src/main/ipc.ts'), 'utf8')
const preload = readFileSync(resolve(root, 'src/preload/index.ts'), 'utf8')
const declaration = readFileSync(resolve(root, 'src/preload/index.d.ts'), 'utf8')
const styles = readFileSync(resolve(root, 'src/renderer/src/index.css'), 'utf8')
const systemStyles = readFileSync(resolve(root, 'src/renderer/src/styles/ui-system.css'), 'utf8')
const i18n = readFileSync(resolve(root, 'src/renderer/src/lib/i18n.ts'), 'utf8')

describe('Inbox capture and delete workflow', () => {
  it('uses a multiline capture editor and keeps Enter available for newlines', () => {
    expect(page).toContain('useRef<HTMLTextAreaElement>')
    expect(page).toContain('<textarea')
    expect(page).toContain('event.ctrlKey || event.metaKey')
    expect(styles).toContain('.inbox-capture > textarea')
    expect(styles).toContain('resize: vertical')
    expect(systemStyles).toContain('textarea:not(.tag-composer-input):not(.inbox-capture-input)')
  })

  it('exposes soft deletion from service through IPC, preload and the visible drawer action', () => {
    expect(page).toContain('handleDelete')
    expect(page).toContain('workspace.deleteInbox')
    expect(store).toContain('window.api.inbox.delete')
    expect(service).toContain('softDelete(publicId: string)')
    expect(ipc).toContain("'inbox:delete'")
    expect(preload).toContain("ipcRenderer.invoke('inbox:delete'")
    expect(declaration).toContain('delete: (publicId: string) => Promise<InboxItem | null>')
    expect(i18n).toContain("'workspace.deleteInbox'")
  })
})

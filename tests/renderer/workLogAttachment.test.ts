import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '../..')
const page = readFileSync(resolve(root, 'src/renderer/src/pages/WorkLogPage.tsx'), 'utf8')
const editor = readFileSync(resolve(root, 'src/renderer/src/pages/WorkLogEditorPage.tsx'), 'utf8')
const preload = readFileSync(resolve(root, 'src/preload/index.ts'), 'utf8')

describe('work log attachments', () => {
  it('supports paste and drop image insertion in the new log composer', () => {
    expect(page).toContain('onPaste={handleComposerPaste}')
    expect(page).toContain('onDrop={handleComposerDrop}')
    expect(page).toContain('window.api.attachment.save')
  })

  it('supports the same attachment insertion in the editor window', () => {
    expect(editor).toContain('onPaste={handleEditorPaste}')
    expect(editor).toContain('onDrop={handleEditorDrop}')
  })

  it('exposes the attachment save API to the renderer', () => {
    expect(preload).toContain('attachment: {')
    expect(preload).toContain("ipcRenderer.invoke('attachment:save'")
  })
})

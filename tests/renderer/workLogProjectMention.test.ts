import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '../..')
const page = readFileSync(resolve(root, 'src/renderer/src/pages/WorkLogPage.tsx'), 'utf8')
const editorPage = readFileSync(resolve(root, 'src/renderer/src/pages/WorkLogEditorPage.tsx'), 'utf8')
const styles = readFileSync(resolve(root, 'src/renderer/src/index.css'), 'utf8')

describe('work log project mentions', () => {
  it('provides project mention suggestions and keyboard selection in the composer', () => {
    expect(page).toContain('findProjectMention')
    expect(page).toContain('replaceProjectMention')
    expect(page).toContain('`@${project.name}`')
    expect(page).toContain('findTagMention')
    expect(page).toContain('tagMention')
    expect(page).toContain('role="listbox"')
    expect(page).toContain('ArrowDown')
    expect(page).toContain('project_id: resolveProjectReference(trimmed, projects)')
  })

  it('has a stable project mention menu surface', () => {
    expect(styles).toContain('.project-mention-menu')
    expect(styles).toContain('.project-mention-option')
    expect(styles).toContain('.tag-mention-option')
  })

  it('anchors suggestion menus to the caret in both composer surfaces', () => {
    expect(page).toContain('getTextareaCaretPosition')
    expect(page).toContain('getMentionMenuPosition')
    expect(editorPage).toContain('getTextareaCaretPosition')
    expect(editorPage).toContain('getMentionMenuPosition')
    expect(styles).toContain('.worklog-mention-menu')
  })
})

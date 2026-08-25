import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '../..')
const page = readFileSync(resolve(root, 'src/renderer/src/pages/WorkLogEditorPage.tsx'), 'utf8')
const styles = readFileSync(resolve(root, 'src/renderer/src/index.css'), 'utf8')

describe('work log editor mentions', () => {
  it('provides the same # and @ completion surface as the composer', () => {
    expect(page).toContain("findProjectMention")
    expect(page).toContain("findTagMention")
    expect(page).toContain("replaceProjectMention")
    expect(page).toContain('<TagHighlightTextarea')
    expect(page).toContain('worklog-editor-content-shell')
    expect(page).toContain('worklog-project-mention-list')
    expect(page).toContain('worklog-tag-mention-list')
    expect(page).toContain('window.api.tag.list')
    expect(page).toContain('syncProjectReference')
    expect(page).toContain('resolveProjectReference')
  })

  it('stretches the highlighted editor content area instead of collapsing to one line', () => {
    expect(styles).toMatch(/\.worklog-editor-content-shell\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;/s)
    expect(styles).toMatch(/\.worklog-editor-composer\s*\{[^}]*flex:\s*1\s+1\s+auto;/s)
    expect(page.indexOf('worklog-editor-property-bar')).toBeLessThan(page.indexOf('worklog-editor-content-shell'))
    expect(page).not.toContain('className="worklog-editor-associations"')
    expect(page).toContain('extractHashTags(trimmedContent).tags')
  })

  it('keeps the editor footer visible while the正文 area auto-grows to a capped scroll region', () => {
    expect(page).toContain('autoGrow')
    expect(styles).toMatch(/\.worklog-editor-window\s*\{[^}]*height:\s*100vh;[^}]*overflow:\s*hidden;/s)
    expect(styles).toMatch(/\.worklog-editor-main\s*\{[^}]*overflow:\s*hidden;/s)
    expect(styles).toMatch(/\.worklog-editor-composer\s*\{[^}]*max-height:/s)
    expect(styles).toMatch(/\.worklog-editor-composer \.tag-composer-input\s*\{[^}]*overflow-y:\s*auto;/s)
    expect(styles).toMatch(/\.worklog-editor-footer\s*\{[^}]*flex:\s*none;/s)
  })
})

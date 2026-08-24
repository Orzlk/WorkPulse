import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '../..')
const page = readFileSync(resolve(root, 'src/renderer/src/pages/WorkLogPage.tsx'), 'utf8')
const styles = readFileSync(resolve(root, 'src/renderer/src/index.css'), 'utf8')
const highlightInput = readFileSync(resolve(root, 'src/renderer/src/components/TagHighlightTextarea.tsx'), 'utf8')

describe('work log card layout', () => {
  it('uses a neutral Flomo-like visual foundation', () => {
    expect(styles).toContain('--paper: #f7f8fa;')
    expect(styles).toContain('--paper-raised: #ffffff;')
    expect(styles).toContain('--ink: #303236;')
    expect(styles).toContain('--forest: #2ecf78;')
    expect(styles).toContain('--rule: #e7e8eb;')
    expect(styles).toMatch(/(?:\.hallmark-app\s+)?\.quick-entry::before,\s*(?:\.hallmark-app\s+)?\.quick-entry::after\s*\{[^}]*display:\s*none;/s)
    expect(styles).toMatch(/(?:\.hallmark-app\s+)?\.log-row:hover\s*\{[^}]*background:\s*var\(--paper-raised\);/s)
  })

  it('renders the composer shell as a rounded card', () => {
    expect(styles).toMatch(/\.quick-entry\s*\{[^}]*border-radius:\s*16px;/s)
  })

  it('keeps project, repository and tag associations inside the composer card', () => {
    const cardStart = page.indexOf('className={`quick-entry')
    const associationBlock = page.indexOf('className="quick-create-associations quick-entry-associations worklog-associations"')
    const footer = page.indexOf('className="quick-entry-footer"')

    expect(cardStart).toBeGreaterThanOrEqual(0)
    expect(associationBlock).toBeGreaterThan(cardStart)
    expect(associationBlock).toBeLessThan(footer)
    expect(styles).toMatch(/\.quick-entry\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;/s)
    expect(styles).toMatch(/\.quick-entry \.quick-entry-associations\s*\{[^}]*order:\s*2;/s)
    expect(styles).toMatch(/\.quick-entry-footer\s*\{[^}]*order:\s*3;/s)
  })

  it('uses a stable card shell with an always-available overflow menu', () => {
    expect(page).toContain('className="log-card-header"')
    expect(page).toContain('className="log-card-menu"')
    expect(page).toContain("aria-label={t('worklog.moreActions')}")
  })

  it('does not change card padding on hover', () => {
    expect(styles).toContain('.log-row:hover')
    expect(styles).not.toMatch(/\.log-row:hover\s*\{[^}]*padding-left:/s)
    expect(styles).toMatch(/\.log-row\s*\{[^}]*border:\s*1px\s+solid/s)
  })

  it('restores ordered and unordered list markers for Markdown content', () => {
    expect(styles).toContain('.log-content-markdown ol {')
    expect(styles).toContain('list-style: decimal;')
    expect(styles).toContain('.log-content-markdown ul {')
    expect(styles).toContain('list-style: disc;')
  })

  it('renders interactive references inside the Markdown body', () => {
    const component = readFileSync(resolve(root, 'src/renderer/src/components/InteractiveMarkdown.tsx'), 'utf8')
    expect(page).toContain('<InteractiveMarkdown')
    expect(component).toContain('ReactMarkdown')
    expect(component).toContain('onTagClick')
    expect(component).toContain('onProjectClick')
    expect(styles).toContain('.inline-reference')
    expect(styles).toContain('.inline-reference.is-selected')
  })

  it('uses a separate project color while keeping the existing tag color', () => {
    expect(highlightInput).toContain('highlightComposerReferences')
    expect(highlightInput).toContain('tag-composer-highlight-project')
    expect(styles).toContain('--project-accent:')
    expect(styles).toMatch(/\.inline-project-reference\s*\{[^}]*color:\s*var\(--project-accent\);/s)
    expect(styles).toMatch(/\.inline-hash-reference\s*\{[^}]*color:\s*#4d7de8;/s)
  })
})

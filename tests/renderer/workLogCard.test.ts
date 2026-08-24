import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '../..')
const page = readFileSync(resolve(root, 'src/renderer/src/pages/WorkLogPage.tsx'), 'utf8')
const styles = readFileSync(resolve(root, 'src/renderer/src/index.css'), 'utf8')

describe('work log card layout', () => {
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
})

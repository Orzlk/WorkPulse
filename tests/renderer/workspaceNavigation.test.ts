import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '../..')
const inboxPage = readFileSync(resolve(root, 'src/renderer/src/pages/InboxPage.tsx'), 'utf8')
const workLogPage = readFileSync(resolve(root, 'src/renderer/src/pages/WorkLogPage.tsx'), 'utf8')
const projectsPage = readFileSync(resolve(root, 'src/renderer/src/pages/ProjectsPage.tsx'), 'utf8')
const repositoriesPage = readFileSync(resolve(root, 'src/renderer/src/pages/RepositoriesPage.tsx'), 'utf8')
const styles = readFileSync(resolve(root, 'src/renderer/src/index.css'), 'utf8')
const i18n = readFileSync(resolve(root, 'src/renderer/src/lib/i18n.ts'), 'utf8')

describe('workspace navigation and selection styling', () => {
  it('uses the same shared page header for workspace pages and tag filters', () => {
    expect(inboxPage).toContain('<WorkspacePageHeader')
    expect(workLogPage).toContain('<WorkspacePageHeader')
    expect(projectsPage).toContain('<WorkspacePageHeader')
    expect(repositoriesPage).toContain('<WorkspacePageHeader')
    expect(styles).toContain('.workspace-breadcrumb')
    expect(styles).not.toContain('.workspace-breadcrumb-index')
    expect(i18n).toContain("'workspace.allNotes'")
    expect(i18n).toContain("'workspace.breadcrumbLabel'")
  })

  it('keeps the current tag selected and exposes a clickable tag menu', () => {
    expect(workLogPage).toContain("setTagFilter(tagPathParts.slice(0, index + 1).join('/'))")
    expect(workLogPage).toContain('menuItems:')
    expect(workLogPage).not.toContain("index === tagPathParts.length - 1 ? '' : tagPathParts.slice")
    expect(readFileSync(resolve(root, 'src/renderer/src/components/WorkspaceBreadcrumb.tsx'), 'utf8')).toContain('workspace-breadcrumb-menu')
    expect(readFileSync(resolve(root, 'src/renderer/src/components/WorkspaceBreadcrumb.tsx'), 'utf8')).toContain('aria-expanded')
  })

  it('uses one visible orange accent for active tag and project filters', () => {
    expect(styles).toContain('--selection-accent:')
    expect(styles).toContain('--selection-accent-strong:')
    expect(styles).toContain('.tag-tree-label.is-selected')
    expect(styles).toContain('.inline-reference.is-selected')
    expect(styles).toContain('.worklog-filter-chip.is-selected')
    expect(styles).toContain('var(--selection-accent)')
  })
})

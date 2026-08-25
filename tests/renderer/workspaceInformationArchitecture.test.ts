import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string): string => readFileSync(path, 'utf8')

const app = read('src/renderer/src/App.tsx')
const pages = {
  worklog: read('src/renderer/src/pages/WorkLogPage.tsx'),
  inbox: read('src/renderer/src/pages/InboxPage.tsx'),
  kanban: read('src/renderer/src/pages/KanbanPage.tsx'),
  projects: read('src/renderer/src/pages/ProjectsPage.tsx'),
  repositories: read('src/renderer/src/pages/RepositoriesPage.tsx'),
  report: read('src/renderer/src/pages/ReportPage.tsx'),
  stats: read('src/renderer/src/pages/StatsPage.tsx'),
  settings: read('src/renderer/src/pages/SettingsPage.tsx')
}
const styles = read('src/renderer/src/index.css')
const i18n = read('src/renderer/src/lib/i18n.ts')

describe('workspace information architecture', () => {
  it('groups primary navigation by domain while preserving deep pages', () => {
    expect(app).toContain('primaryNavigation')
    expect(app).toContain("labelKey: 'nav.records'")
    expect(app).toContain("labelKey: 'nav.tasks'")
    expect(app).toContain("labelKey: 'nav.review'")
    expect(app).toContain("pages: ['worklog', 'inbox']")
    expect(app).toContain("pages: ['report', 'stats']")
    expect(app).toContain('group.pages.includes(currentPage as')
    expect(i18n).toContain("'nav.records': '记录'")
    expect(i18n).toContain("'nav.review': '复盘'")
  })

  it('uses shared section tabs for every multi-page workspace domain', () => {
    expect(pages.worklog).toContain('WorkspaceSectionTabs')
    expect(pages.inbox).toContain('WorkspaceSectionTabs')
    expect(pages.projects).toContain('WorkspaceSectionTabs')
    expect(pages.repositories).toContain('WorkspaceSectionTabs')
    expect(pages.report).toContain('WorkspaceSectionTabs')
    expect(pages.stats).toContain('WorkspaceSectionTabs')
    expect(styles).toContain('.workspace-section-tabs')
  })

  it('uses a shared page header shell across all workspace pages', () => {
    expect(pages.worklog).toContain('WorkspacePageHeader')
    expect(pages.inbox).toContain('WorkspacePageHeader')
    expect(pages.kanban).toContain('WorkspacePageHeader')
    expect(pages.projects).toContain('WorkspacePageHeader')
    expect(pages.repositories).toContain('WorkspacePageHeader')
    expect(pages.report).toContain('WorkspacePageHeader')
    expect(pages.stats).toContain('WorkspacePageHeader')
    expect(pages.settings).toContain('WorkspacePageHeader')
    expect(styles).toContain('.workspace-page-heading-row')
  })

  it('uses the orange selection accent for active navigation', () => {
    expect(styles).toContain('.hallmark-app .app-nav-button.is-active')
    expect(styles).toContain('var(--selection-accent)')
    expect(styles).toContain('.workspace-section-tab.is-active')
  })

  it('uses a neutral note placeholder and removes unexplained page numbering', () => {
    expect(i18n).toContain("'worklog.inputPlaceholder': '现在的想法是...'")
    expect(pages.inbox).not.toContain('index="01"')
    expect(pages.projects).not.toContain('index="02"')
    expect(pages.repositories).not.toContain('index="03"')
    expect(read('src/renderer/src/components/WorkspacePageHeader.tsx')).not.toContain('index?: string')
    expect(read('src/renderer/src/components/WorkspaceBreadcrumb.tsx')).not.toContain('workspace-breadcrumb-index')
    expect(styles).not.toContain('.workspace-breadcrumb-index')
  })
})

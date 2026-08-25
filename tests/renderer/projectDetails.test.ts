import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '../..')
const page = readFileSync(resolve(root, 'src/renderer/src/pages/ProjectsPage.tsx'), 'utf8')
const store = readFileSync(resolve(root, 'src/renderer/src/stores/projectStore.ts'), 'utf8')
const styles = readFileSync(resolve(root, 'src/renderer/src/index.css'), 'utf8')

describe('project details', () => {
  it('provides an editable project detail drawer with summary metrics', () => {
    expect(store).toContain('update:')
    expect(page).toContain('project-detail-drawer')
    expect(page).toContain('role="dialog"')
    expect(store).toContain('window.api.project.update')
    expect(page).toContain('project.summary.work_logs')
    expect(page).toContain('project.summary.git_commits')
  })

  it('keeps project cards and drawer controls keyboard accessible', () => {
    expect(page).toContain('aria-label={t(\'workspace.openProject\'')
    expect(page).toContain('onKeyDown')
    expect(styles).toContain('.project-detail-overlay')
    expect(styles).toContain('.project-detail-drawer')
    expect(styles).toContain('.project-detail-drawer:focus')
  })
})

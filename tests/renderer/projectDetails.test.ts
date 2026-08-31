import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '../..')
const page = readFileSync(resolve(root, 'src/renderer/src/pages/ProjectsPage.tsx'), 'utf8')
const timeline = readFileSync(resolve(root, 'src/renderer/src/components/ProjectActivityTimeline.tsx'), 'utf8')
const card = readFileSync(resolve(root, 'src/renderer/src/components/KanbanTaskCard.tsx'), 'utf8')
const taskDrawer = readFileSync(resolve(root, 'src/renderer/src/components/TaskDetailDrawer.tsx'), 'utf8')
const store = readFileSync(resolve(root, 'src/renderer/src/stores/projectStore.ts'), 'utf8')
const styles = readFileSync(resolve(root, 'src/renderer/src/index.css'), 'utf8')
const translations = readFileSync(resolve(root, 'src/renderer/src/lib/i18n.ts'), 'utf8')
const preload = readFileSync(resolve(root, 'src/preload/index.ts'), 'utf8')
const palettePath = resolve(root, 'src/renderer/src/lib/projectColors.ts')
const palette = existsSync(palettePath) ? readFileSync(palettePath, 'utf8') : ''

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

  it('loads a reverse chronological activity timeline when a project opens', () => {
    expect(preload).toContain("'project:activity'")
    expect(page).toContain('window.api.project.activity')
    expect(page).toContain('ProjectActivityTimeline')
  })

  it('renders project work logs with the shared Markdown renderer', () => {
    expect(timeline).toContain("item.type === 'work_log'")
    expect(timeline).toContain('<InteractiveMarkdown')
    expect(timeline).toContain('log-content-markdown')
  })

  it('opens the full task detail drawer from project activity', () => {
    expect(timeline).toContain('onTaskClick')
    expect(timeline).toContain('project-activity-task-link')
    expect(page).toContain('window.api.task.get')
    expect(page).toContain('<TaskDetailDrawer')
    expect(page).toContain('handleTaskSave')
  })

  it('labels checklist progress clearly on task cards', () => {
    expect(card).toContain("t('kanban.checklistProgress'")
    expect(card).not.toMatch(/<CheckSquare[\s\S]*>\{completed\}\/\{task\.checklist\.length\}/)
    expect(translations).toContain("'kanban.checklist': '任务清单'")
  })

  it('keeps task details above project details and closes only the top layer', () => {
    expect(taskDrawer).toContain('task-detail-overlay')
    expect(styles).toMatch(/\.task-detail-overlay\s*\{[^}]*z-index:\s*70;/s)
    expect(page).toContain('!activeTask')
  })

  it('offers a reusable, accessible preset project color palette in create and edit states', () => {
    expect(palette).toContain('PROJECT_COLOR_OPTIONS')
    expect(palette.match(/value: '#[0-9a-f]{6}'/gi)?.length).toBeGreaterThanOrEqual(8)
    expect(page).toContain('ProjectColorPicker')
    expect(page).toContain('PROJECT_COLOR_OPTIONS')
    expect(page).toContain('aria-pressed')
    expect(styles).toContain('.project-color-options')
  })

  it('uses compact color dots beside project names instead of a card color bar', () => {
    expect(page).toContain('project-color-dot')
    expect(page).toContain('project-detail-color-dot')
    expect(styles).toContain('.project-color-dot')
    expect(styles).toContain('.project-detail-color-dot')
    expect(styles).not.toContain('.project-color { position: absolute')
  })

  it('adds a restrained color halo and interaction feedback to project dots', () => {
    expect(page).toContain("'--project-color': project.color")
    expect(page).toContain("'--project-color': selectedProject.color")
    expect(styles).toContain('color-mix(in srgb, var(--project-color,')
    expect(styles).toContain('.project-card-main:hover .project-color-dot')
    expect(styles).toContain('.project-card-main:focus-visible .project-color-dot')
    expect(styles).toContain('transition: transform')
  })

  it('keeps the full project color palette inside a compact picker popover', () => {
    expect(page).toContain('project-color-trigger')
    expect(page).toContain('project-color-popover')
    expect(page).toContain('aria-expanded={open}')
    expect(page).toContain('setOpen(false)')
    expect(styles).toContain('.project-color-popover')
    expect(styles).toContain('.project-color-trigger')
    expect(translations).toContain("'workspace.chooseColor'")
  })

  it('keeps the closed color trigger free of visible color names', () => {
    expect(page).not.toContain('project-color-trigger-label')
    expect(page).toContain('project-color-trigger-swatch')
    expect(page).toContain('aria-label={`${t(\'workspace.chooseColor\')}: ${selectedLabel}`}')
    expect(styles).not.toContain('.project-color-trigger-label')
  })

  it('keeps project editing available and protects deletion with confirmation', () => {
    expect(page).toContain('handleDeleteProject')
    expect(page).toContain('workspace.deleteProjectConfirm')
    expect(page).toContain('setEditing(true)')
    expect(page).toContain("t('workspace.editProject')")
    expect(translations).toContain("'workspace.deleteProjectConfirm'")
    expect(styles).toContain('.project-menu-trigger')
  })

  it('groups project edit and delete actions behind a corner menu', () => {
    expect(page).toContain('project-menu')
    expect(page).toContain('project-menu-trigger')
    expect(page).toContain('Ellipsis')
    expect(page).toContain("t('workspace.editProject')")
    expect(page).toContain("t('workspace.deleteProject')")
    expect(styles).toContain('.project-menu-panel')
    expect(translations).toContain("'workspace.projectMenu'")
  })
})

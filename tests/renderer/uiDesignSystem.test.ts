import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const systemPath = 'src/renderer/src/styles/ui-system.css'
const mainPath = 'src/renderer/src/main.tsx'
const appPath = 'src/renderer/src/App.tsx'
const tabsPath = 'src/renderer/src/components/WorkspaceSectionTabs.tsx'
const reportPath = 'src/renderer/src/pages/ReportPage.tsx'
const settingsPath = 'src/renderer/src/pages/SettingsPage.tsx'
const drawerPath = 'src/renderer/src/components/TaskDetailDrawer.tsx'
const legacyCssPath = 'src/renderer/src/index.css'

const system = existsSync(systemPath) ? readFileSync(systemPath, 'utf8') : ''
const main = readFileSync(mainPath, 'utf8')
const app = readFileSync(appPath, 'utf8')
const tabs = readFileSync(tabsPath, 'utf8')
const report = readFileSync(reportPath, 'utf8')
const settings = readFileSync(settingsPath, 'utf8')
const drawer = readFileSync(drawerPath, 'utf8')
const legacyCss = readFileSync(legacyCssPath, 'utf8')

describe('WorkPulse UI design system', () => {
  it('defines semantic light and dark theme tokens for surfaces, text, states and controls', () => {
    expect(existsSync(systemPath)).toBe(true)
    expect(system).toContain('--ui-color-canvas')
    expect(system).toContain('--ui-color-surface')
    expect(system).toContain('--ui-color-primary')
    expect(system).toContain('--ui-color-selection')
    expect(system).toContain('--ui-color-danger')
    expect(system).toContain(':root.dark')
  })

  it('defines shared control primitives and accessible focus behavior', () => {
    expect(system).toContain('.ui-button')
    expect(system).toContain('.ui-icon-button')
    expect(system).toContain('.ui-card')
    expect(system).toContain('.ui-field')
    expect(system).toContain('.ui-button:focus-visible')
    expect(system).toContain('prefers-reduced-motion')
  })

  it('uses the rounded green glow as the only focus treatment for form controls', () => {
    expect(system).toContain(':where(input, textarea, select):focus')
    expect(system).toContain(':where(input, textarea, select):focus-visible')
    expect(system).toContain('outline: 0 !important')
    expect(system).toContain('.hallmark-app .global-search:focus-within')
    expect(system).toContain('.hallmark-app .quick-create-panel:focus-within')
    expect(system).toContain('.hallmark-app .inbox-capture:focus-within')
    expect(system).toContain('.hallmark-app .worklog-search-input:focus')
    expect(system).toContain(':not(.global-search-input)')
    expect(system).toContain(':not(.quick-create-input)')
    expect(system).toContain(':not(.inbox-capture-input)')
  })

  it('loads the design system after legacy styles so semantic tokens are authoritative', () => {
    expect(main.indexOf("import './index.css'")).toBeGreaterThanOrEqual(0)
    expect(main.indexOf("import './styles/ui-system.css'")).toBeGreaterThan(main.indexOf("import './index.css'"))
  })

  it('uses one visual active-state vocabulary for primary navigation and section tabs', () => {
    expect(app).toContain('app-nav-button')
    expect(app).toContain("is-active")
    expect(tabs).toContain('workspace-section-tab')
    expect(tabs).toContain('is-active')
  })

  it('uses semantic scope controls instead of dark legacy borders', () => {
    expect(report).toContain('ui-scope-option')
    expect(report).not.toContain('border-zinc-900')
    expect(report).not.toContain('dark:border-zinc-100')
    expect(system).toContain('.ui-scope-option.is-selected')
  })

  it('normalizes selected theme controls and keeps a legacy border fallback', () => {
    expect(settings).toContain('ui-choice-option')
    expect(settings).not.toContain('border-zinc-900')
    expect(system).toContain('.ui-choice-option.is-selected')
    expect(system).toContain('.hallmark-app .border-zinc-900')
  })

  it('keeps portal modal backdrops translucent over the hallmark canvas background', () => {
    expect(system).toContain('.hallmark-app.portal-root')
    expect(system).toContain('.hallmark-app.task-detail-overlay')
    expect(system).toContain('rgba(30, 34, 39, .34)')
  })

  it('renders the task drawer save action with the semantic primary button and a guarded save call', () => {
    expect(drawer).toContain('ui-button ui-button--primary')
    expect(drawer).toContain('void handleSave().catch')
    expect(drawer).not.toContain('bg-zinc-900 px-3 py-2')
  })

  it('keeps legacy tailwind remaps aligned with ui-system tokens', () => {
    expect(legacyCss).toContain('.hallmark-app .rounded-lg {\n  border-radius: var(--ui-radius-sm);\n}')
    expect(legacyCss).toContain('.hallmark-app .rounded-xl {\n  border-radius: var(--ui-radius-md);\n}')
    expect(legacyCss).toContain('.hallmark-app .shadow-lg,\n.hallmark-app .shadow-2xl {\n  box-shadow: var(--ui-shadow-lg);\n}')
    expect(legacyCss).toContain('outline: 2px solid var(--ui-color-focus)')
    expect(legacyCss).not.toContain('outline: 2px solid var(--gold)')
  })

  it('defines every ui-button variant used by pages', () => {
    expect(system).toContain('.ui-button--primary')
    expect(system).toContain('.ui-button--secondary')
    expect(system).toContain('.ui-button--ghost')
    expect(system).toContain('.ui-button--danger')
  })
})

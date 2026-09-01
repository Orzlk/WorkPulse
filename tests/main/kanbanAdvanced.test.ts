import { describe, expect, it } from 'vitest'
import { normalizeChecklist, isTaskPriority } from '../../src/main/kanban/kanbanTypes'
import { readFileSync } from 'node:fs'

const migrations = readFileSync('src/main/database/migrations.ts', 'utf8')
const db = readFileSync('src/main/db.ts', 'utf8')
const preload = readFileSync('src/preload/index.ts', 'utf8')
const kanbanPage = readFileSync('src/renderer/src/pages/KanbanPage.tsx', 'utf8')
const kanbanCard = readFileSync('src/renderer/src/components/KanbanTaskCard.tsx', 'utf8')
const taskDrawer = readFileSync('src/renderer/src/components/TaskDetailDrawer.tsx', 'utf8')

describe('看板高级功能', () => {
  it('normalizes checklist items and validates priorities', () => {
    expect(normalizeChecklist([{ id: 'a', text: '  联调  ', completed: 1 }, { text: '', completed: false }])).toEqual([
      { id: 'a', text: '联调', completed: true }
    ])
    expect(isTaskPriority('high')).toBe(true)
    expect(isTaskPriority('unknown')).toBe(false)
  })

  it('persists task priority, checklist, and configurable board columns', () => {
    expect(migrations).toContain('CURRENT_SCHEMA_VERSION = 1')
    expect(migrations).toContain("name: '001_initial_schema'")
    expect(migrations).toContain("addColumnIfMissing(database, 'tasks', 'priority'")
    expect(migrations).toContain("addColumnIfMissing(database, 'tasks', 'checklist'")
    expect(migrations).toContain('CREATE TABLE IF NOT EXISTS kanban_columns')
    expect(db).toContain('getKanbanColumns')
    expect(db).toContain('createKanbanColumn')
    expect(preload).toContain('kanban:columns:list')
    expect(kanbanCard).toContain('priority')
    expect(taskDrawer).toContain('checklist')
    expect(kanbanPage).toContain('TaskDetailDrawer')
    expect(kanbanPage).toContain('window.api.kanban.columns.create')
  })

  it('keeps task editing open after save and protects unsaved drawer changes', () => {
    expect(taskDrawer).toContain('const isDirty =')
    expect(taskDrawer).toContain('requestClose')
    expect(taskDrawer).toContain("kanban.discardChangesConfirm")
    expect(taskDrawer).toContain("t('common.saved')")
    expect(taskDrawer).toContain("t('common.saving')")
    expect(taskDrawer).toContain('event.ctrlKey || event.metaKey')
    expect(taskDrawer).not.toContain('onClose()\n    }')
    expect(taskDrawer).toContain('void handleSave().catch')
    expect(taskDrawer).toContain("document.addEventListener('keydown'")
    expect(taskDrawer).toContain('stopPropagation')
  })

  it('keeps task ownership independent from repositories', () => {
    expect(kanbanPage).not.toContain('useRepositoryStore')
    expect(kanbanPage).not.toContain('newRepositoryId')
    expect(taskDrawer).not.toContain('repositories:')
    expect(taskDrawer).not.toContain('repositoryId')
  })

  it('keeps the detail drawer closed while dragging a card', () => {
    expect(kanbanPage).toContain('const [draggingTask')
    expect(kanbanPage).toMatch(/onDragStart=\{handleDragStart\}/)
    expect(kanbanPage).toContain('onDragCancel={() => setDraggingTask(null)}')
    expect(kanbanPage).toContain('<DragOverlay>{draggingTask ?')
  })

  it('keeps the board as the primary surface with a compact top toolbar', () => {
    expect(kanbanPage).not.toContain('kanban.newTaskHelp')
    expect(kanbanPage).not.toContain('newTaskSubtitle')
    expect(kanbanPage).not.toContain('{columns.length} {t(\'kanban.columnName\')}')
    expect(kanbanPage).toContain("actions={<><button type=\"button\" onClick={handleOpenTaskCreate}")
    expect(kanbanPage).toContain('className="mb-4 flex flex-wrap items-center gap-2"')
    const tabs = readFileSync('src/renderer/src/components/WorkspaceSectionTabs.tsx', 'utf8')
    expect(tabs).toContain('workspace-section-tab-actions')
  })

  it('renders task cards with token badges, checklist progress bar, and accessible controls', () => {
    expect(kanbanCard).toContain('h-1 w-12')
    expect(kanbanCard).toContain('--ui-color-tag-soft')
    expect(kanbanCard).toContain('--ui-color-danger-soft')
    expect(kanbanCard).toContain('dark:text-red-400')
    expect(kanbanCard).toContain("task.priority !== 'medium'")
    expect(kanbanCard).toContain('requestAnimationFrame')
    expect(kanbanCard).not.toContain('kanban-move-control')
    expect(kanbanCard).not.toContain('bg-red-50 text-red-600')
    expect(kanbanCard).not.toContain('bg-amber-50')
    expect(kanbanCard).not.toContain('bg-zinc-100 text-zinc-500')
    expect(kanbanCard).not.toMatch(/(?<!dark:)text-zinc-300/)
    expect(kanbanPage).not.toContain("text-zinc-300\">{t('kanban.dropHere')}")
    expect(kanbanPage).not.toContain("text-zinc-300\">{t('kanban.noDrafts')}")
  })
})

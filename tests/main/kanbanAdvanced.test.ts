import { describe, expect, it } from 'vitest'
import { normalizeChecklist, isTaskPriority } from '../../src/main/kanban/kanbanTypes'
import { readFileSync } from 'node:fs'

const migrations = readFileSync('src/main/database/migrations.ts', 'utf8')
const db = readFileSync('src/main/db.ts', 'utf8')
const preload = readFileSync('src/preload/index.ts', 'utf8')
const kanbanPage = readFileSync('src/renderer/src/pages/KanbanPage.tsx', 'utf8')

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
    expect(kanbanPage).toContain('checklist')
    expect(kanbanPage).toContain('priority')
    expect(kanbanPage).toContain('window.api.kanban.columns.create')
  })
})

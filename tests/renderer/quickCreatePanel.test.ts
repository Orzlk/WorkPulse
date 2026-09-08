import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildTaskCreateRoute, parseTaskCreateRoute } from '../../src/renderer/src/lib/taskCreateRoute'

const quickCreate = readFileSync('src/renderer/src/components/QuickCreate.tsx', 'utf8')
const i18n = readFileSync('src/renderer/src/lib/i18n.ts', 'utf8')
const mainIndex = readFileSync('src/main/index.ts', 'utf8')
const taskCreatePage = readFileSync('src/renderer/src/pages/TaskCreatePage.tsx', 'utf8')

describe('quick create panel', () => {
  it('unifies log, inbox, and task creation in one panel', () => {
    expect(quickCreate).toContain("type Mode = 'log' | 'inbox' | 'task'")
    expect(quickCreate).toContain("labelKey: 'workspace.modeTask'")
    expect(quickCreate).toContain('useTaskStore')
    expect(quickCreate).toContain("addTask(content, undefined, 'todo', undefined, associations, priority)")
    expect(quickCreate).toContain('quickTaskFullForm')
    expect(quickCreate).toContain('taskCreateWindow.open')
    expect(quickCreate).toContain("mode === 'task' && <label>")
  })

  it('keeps bilingual copy for the task mode and full form shortcut', () => {
    expect(i18n).toContain("'workspace.modeTask': '任务'")
    expect(i18n).toContain("'workspace.modeTask': 'Task'")
    expect(i18n).toContain("'workspace.quickTaskPlaceholder'")
    expect(i18n).toContain("'workspace.quickTaskFullForm'")
    expect(i18n).toContain("'workspace.newProject'")
  })

  it('grows the capture input with content up to a capped height', () => {
    expect(quickCreate).toContain('<textarea id="quick-create-content"')
    expect(quickCreate).toContain('Math.min(Math.max(content, 62), 200)')
    expect(quickCreate).not.toContain("event.key !== 'Enter'")
    expect(quickCreate).not.toContain("onKeyDown={(event) => {")
    expect(i18n).toContain("'workspace.quickKeyboardHelp': 'Enter 换行 · Esc 关闭'")
    expect(i18n).toContain("'workspace.quickKeyboardHelp': 'Enter for a newline · Esc to close'")
  })

  it('passes a task draft to the complete task form without losing its project or priority', () => {
    const route = buildTaskCreateRoute({ content: 'Ship the guard', projectId: 'project-1', priority: 'high' })

    expect(parseTaskCreateRoute(route)).toEqual({
      isTaskCreate: true,
      draft: { content: 'Ship the guard', projectId: 'project-1', priority: 'high' }
    })
    expect(quickCreate).toContain('buildTaskCreateRoute')
    expect(quickCreate).toContain('useOverlayStack')
  })

  it('delivers a later quick-create draft to an already-open task form', () => {
    expect(mainIndex).toContain("taskCreateWindow.webContents.send('task-create:draft', draft)")
    expect(taskCreatePage).toContain('window.api.on.taskCreateDraft')
  })
})

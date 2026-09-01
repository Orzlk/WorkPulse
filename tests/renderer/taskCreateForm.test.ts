import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '../..')
const page = readFileSync(resolve(root, 'src/renderer/src/pages/TaskCreatePage.tsx'), 'utf8')
const db = readFileSync(resolve(root, 'src/main/db.ts'), 'utf8')
const ipc = readFileSync(resolve(root, 'src/main/ipc.ts'), 'utf8')
const mainIndex = readFileSync(resolve(root, 'src/main/index.ts'), 'utf8')
const preload = readFileSync(resolve(root, 'src/preload/index.ts'), 'utf8')
const declaration = readFileSync(resolve(root, 'src/preload/index.d.ts'), 'utf8')
const styles = readFileSync(resolve(root, 'src/renderer/src/index.css'), 'utf8')

describe('新建任务表单', () => {
  it('允许新建任务编辑并提交任务清单', () => {
    expect(page).toContain('const [checklist, setChecklist]')
    expect(page).toContain('kanban.checklist')
    expect(page).toContain('checklistDraft')
    expect(page).toContain('dueDate || null,\n        checklist')
    expect(page).toContain('kanban.addChecklist')
    expect(db).toContain('normalizeChecklist(checklist)')
    expect(ipc).toContain('checklist?:')
    expect(preload).toContain('checklist?:')
    expect(declaration).toContain('checklist?:')
  })

  it('让描述框从较小高度开始并随内容自适应，超长时才滚动', () => {
    expect(page).toContain('useLayoutEffect')
    expect(page).toContain('descriptionRef.current')
    expect(styles).toContain('min-height: 120px')
    expect(styles).toContain('max-height: min(42vh, 360px)')
    expect(styles).toContain('overflow-y: hidden')
  })

  it('在新建任务窗口中跟踪草稿状态，并区分意外关闭与主动放弃', () => {
    expect(page).toContain('taskCreateWindow.setDirty')
    expect(page).toContain('const isDirty =')
    expect(page).toContain('taskCreateWindow.close(true)')
    expect(mainIndex).toContain('shouldPromptTaskCreateClose')
  })

  it('使用固定窗口尺寸并收紧纵向留白，保证默认表单无需滚动', () => {
    expect(page).not.toContain('fitToContent')
    expect(preload).not.toContain("'task-create:fit'")
    expect(declaration).not.toContain('fitToContent')
    expect(styles).toContain('.task-create-window {\n  padding: 22px;\n}')
    expect(styles).toContain('.task-create-main {\n  gap: 14px;\n  padding: 16px 0;')
  })

  it('隐藏原生标题栏并只保留一套关闭控件', () => {
    expect(page).not.toContain('task-create-close')
    expect(styles).not.toContain('.task-create-close')
    expect(styles).toContain('.task-create-window .worklog-editor-header {\n  -webkit-app-region: drag;\n}')
    expect(mainIndex).toContain('titleBarOverlay: buildTaskCreateTitleBarOverlay(isDarkTheme)')
    expect(mainIndex).toContain("titleBarStyle: 'hidden'")
  })
})

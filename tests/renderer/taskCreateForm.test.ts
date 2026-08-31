import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '../..')
const page = readFileSync(resolve(root, 'src/renderer/src/pages/TaskCreatePage.tsx'), 'utf8')
const db = readFileSync(resolve(root, 'src/main/db.ts'), 'utf8')
const ipc = readFileSync(resolve(root, 'src/main/ipc.ts'), 'utf8')
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
})

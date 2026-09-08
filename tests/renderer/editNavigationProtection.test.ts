import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '../..')
const drawer = readFileSync(resolve(root, 'src/renderer/src/components/TaskDetailDrawer.tsx'), 'utf8')
const report = readFileSync(resolve(root, 'src/renderer/src/pages/ReportPage.tsx'), 'utf8')

describe('edit navigation protection', () => {
  it('uses one close request for dirty task drawers instead of a second Escape listener', () => {
    expect(drawer).toContain('registerNavigationGuard')
    expect(drawer).toContain('const requestClose = (): boolean =>')
    expect(drawer).not.toContain("if (event.key === 'Escape')")
  })

  it('protects unsaved report text before returning to history or regenerating', () => {
    expect(report).toContain('registerNavigationGuard')
    expect(report).toContain('useOverlayStack')
    expect(report).toContain('const requestDiscardEdit = (): boolean =>')
    expect(report).toContain('requestDiscardEdit()')
  })
})

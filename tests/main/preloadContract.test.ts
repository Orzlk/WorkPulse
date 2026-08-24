import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '../..')
const implementation = readFileSync(resolve(root, 'src/preload/index.ts'), 'utf8')
const declaration = readFileSync(resolve(root, 'src/preload/index.d.ts'), 'utf8')

describe('preload API contract', () => {
  it('keeps implementation and declaration coverage aligned for domain APIs', () => {
    for (const namespace of ['project', 'inbox', 'tag', 'search', 'repository', 'database', 'ai']) {
      expect(implementation).toContain(`${namespace}: {`)
      expect(declaration).toContain(`${namespace}: {`)
    }
    expect(implementation).toContain('worklogEditor: {')
    expect(declaration).toContain('worklogEditor: {')
    for (const method of ['get:', 'organize:', 'scanAll:', 'export:', 'import:', 'clear:', 'testConnection:', 'delete:']) {
      expect(implementation).toContain(method)
      expect(declaration).toContain(method)
    }
    for (const method of ['open:', 'setDirty:', 'notifyChanged:', 'close:']) {
      expect(implementation).toContain(method)
      expect(declaration).toContain(method)
    }
    expect(implementation).toContain('worklogEditorChanged:')
    expect(declaration).toContain('worklogEditorChanged:')
    expect(implementation).not.toContain('updates: Record<string, unknown>')
  })

  it('registers every declared navigation page channel in the preload listener', () => {
    const implementationPages = implementation.match(/const pages: NavigatePage\[\] = \[([^\]]+)\]/)?.[1] ?? ''
    const declarationPages = declaration.match(/type NavigatePage = ([^\n]+)/)?.[1] ?? ''
    for (const page of ['worklog', 'kanban', 'report', 'stats', 'settings', 'inbox', 'projects', 'repositories']) {
      expect(implementationPages).toContain(`'${page}'`)
      expect(declarationPages).toContain(page)
    }
    expect(implementation).toContain('ipcRenderer.on(`navigate:${page}`, handler)')
  })
})

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '../..')

describe('preload API contract', () => {
  it('keeps implementation and declaration coverage aligned for domain APIs', () => {
    const implementation = readFileSync(resolve(root, 'src/preload/index.ts'), 'utf8')
    const declaration = readFileSync(resolve(root, 'src/preload/index.d.ts'), 'utf8')

    for (const namespace of ['project', 'inbox', 'tag', 'search', 'repository', 'database']) {
      expect(implementation).toContain(`${namespace}: {`)
      expect(declaration).toContain(`${namespace}: {`)
    }
    for (const method of ['get:', 'organize:', 'scanAll:', 'export:', 'import:']) {
      expect(implementation).toContain(method)
      expect(declaration).toContain(method)
    }
    expect(implementation).not.toContain('updates: Record<string, unknown>')
  })
})

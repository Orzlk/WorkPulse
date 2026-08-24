import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '../..')
const page = readFileSync(resolve(root, 'src/renderer/src/pages/RepositoriesPage.tsx'), 'utf8')
const styles = readFileSync(resolve(root, 'src/renderer/src/index.css'), 'utf8')

describe('repository management cards', () => {
  it('renders repository cards with a stable overflow menu and edit/delete actions', () => {
    expect(page).toContain('className="repository-card"')
    expect(page).toContain('className="repository-card-menu"')
    expect(page).toContain('repositoryEdit')
    expect(page).toContain('repositoryDelete')
    expect(page).toContain('remove(publicId)')
  })

  it('keeps repository cards fixed on hover', () => {
    expect(styles).toContain('.repository-card:hover')
    expect(styles).not.toMatch(/\.repository-card:hover\s*\{[^}]*width:/s)
    expect(styles).not.toMatch(/\.repository-card:hover\s*\{[^}]*padding-/s)
  })
})

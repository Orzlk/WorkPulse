import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '../..')
const main = readFileSync(resolve(root, 'src/main/index.ts'), 'utf8')

describe('window chrome', () => {
  it('hides the native menu bar for the main and editor windows', () => {
    const hiddenMenuBarOptions = main.match(/autoHideMenuBar:\s*true/g) ?? []
    expect(hiddenMenuBarOptions.length).toBeGreaterThanOrEqual(2)
  })
})

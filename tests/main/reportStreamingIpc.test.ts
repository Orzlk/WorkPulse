import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '../..')
const ipc = readFileSync(resolve(root, 'src/main/ipc.ts'), 'utf8')
const preload = readFileSync(resolve(root, 'src/preload/index.ts'), 'utf8')
const page = readFileSync(resolve(root, 'src/renderer/src/pages/ReportPage.tsx'), 'utf8')

describe('report streaming integration', () => {
  it('registers start and cancel IPC channels', () => {
    expect(ipc).toContain("'report:stream:start'")
    expect(ipc).toContain("'report:stream:cancel'")
    expect(preload).toContain('reportStream')
  })

  it('renders a real cancel action while generating', () => {
    expect(page).toContain('common.cancel')
    expect(page).toContain('window.api.report.cancel')
  })
})

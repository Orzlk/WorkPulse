import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { isReportScopeAll } from '../../src/renderer/src/lib/reportWorkflow'

const root = resolve(__dirname, '../..')
const page = readFileSync(resolve(root, 'src/renderer/src/pages/ReportPage.tsx'), 'utf8')

describe('report scope selection', () => {
  it('treats an empty scope as all selected', () => {
    expect(isReportScopeAll([])).toBe(true)
    expect(isReportScopeAll(['project-a'])).toBe(false)
  })

  it('exposes all-project and all-repository controls', () => {
    expect(page).toContain('onSelectAll={() => { setProjectIds([]); onProjectChange(null) }}')
    expect(page).toContain('onSelectAll={() => setRepositoryIds([])}')
    expect(page).toContain('aria-pressed={isReportScopeAll(ids)}')
  })
})

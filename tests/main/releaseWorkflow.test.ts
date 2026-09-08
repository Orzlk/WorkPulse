import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const workflow = readFileSync(resolve(process.cwd(), '.github/workflows/release.yml'), 'utf8')

describe('GitHub release workflow storage safety', () => {
  it('cleans intermediate artifacts even when build or publish fails', () => {
    const cleanupJob = workflow.match(/\n  cleanup:\n([\s\S]*)$/)?.[1] ?? ''

    expect(cleanupJob).toContain('if: always()')
    expect(cleanupJob).toContain('needs: [build, publish]')
    expect(cleanupJob).toContain('actions/runs/${{ github.run_id }}/artifacts')
    expect(workflow).not.toContain('      - name: Cleanup intermediate artifacts')
  })

  it('does not upload artifacts that are excluded from the release', () => {
    expect(workflow).toContain('!dist/*.dmg.blockmap')
  })

  it('builds only the supported Windows installer', () => {
    expect(workflow).toContain('name: Windows-x64')
    expect(workflow).not.toContain('name: macOS-x64')
    expect(workflow).not.toContain('name: macOS-arm64')
    expect(workflow).not.toContain('name: Linux-x64')
  })
})

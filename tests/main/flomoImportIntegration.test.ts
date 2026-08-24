import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let userDataPath = ''
vi.mock('electron', () => ({ app: { getPath: () => userDataPath } }))

import { addWorkLog, getDatabase, getWorkLogs, initDatabase, workLogExists } from '../../src/main/db'
import { parseFlomoHtml } from '../../src/main/importers/flomoHtmlImporter'
import { importFlomoMemos } from '../../src/main/importers/flomoLogImport'

const directories: string[] = []

afterEach(() => {
  try { getDatabase().close() } catch { /* database was not opened */ }
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('importFlomoMemos', () => {
  it('writes Flomo logs with tags and skips the same record on a second import', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'workpulse-flomo-import-'))
    directories.push(directory)
    userDataPath = directory
    await initDatabase()

    const parsed = parseFlomoHtml(`
      <div class="memo">
        <div class="time">2026-08-19 09:45:51</div>
        <div class="content"><p>#工作/三峡</p><p>历史日志</p></div>
        <div class="files"><img src="file/a.png"></div>
      </div>
    `)
    const writer = { addWorkLog, workLogExists }

    expect(importFlomoMemos(parsed.memos, writer)).toEqual({ imported: 1, skipped: 0 })
    expect(importFlomoMemos(parsed.memos, writer)).toEqual({ imported: 0, skipped: 1 })

    expect(getWorkLogs()).toEqual([expect.objectContaining({ content: '历史日志', tag_names: ['工作/三峡'] })])
    expect((getDatabase().prepare('SELECT COUNT(*) AS count FROM work_log_tags').get() as { count: number }).count).toBe(1)
  })
})

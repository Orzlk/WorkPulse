import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

    expect(importFlomoMemos(parsed.memos, writer)).toEqual({ imported: 1, skipped: 0, attachmentsImported: 0, attachmentsSkipped: 0 })
    expect(importFlomoMemos(parsed.memos, writer)).toEqual({ imported: 0, skipped: 1, attachmentsImported: 0, attachmentsSkipped: 0 })

    expect(getWorkLogs()).toEqual([expect.objectContaining({ content: '#工作/三峡\n\n历史日志\n\n![](file/a.png)', tag_names: ['工作/三峡'] })])
    expect((getDatabase().prepare('SELECT COUNT(*) AS count FROM work_log_tags').get() as { count: number }).count).toBe(1)
  })

  it('copies image attachments, rewrites the body, and skips unsupported or missing files individually', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'workpulse-flomo-import-'))
    const sourceRoot = join(directory, 'flomo-export')
    const attachmentRoot = join(directory, 'attachments')
    mkdirSync(join(sourceRoot, 'files'), { recursive: true })
    writeFileSync(join(sourceRoot, 'files', 'deploy.png'), Buffer.from([137, 80, 78, 71]))
    directories.push(directory)
    userDataPath = directory
    await initDatabase()

    const parsed = parseFlomoHtml(`
      <div class="memo">
        <div class="time">2026-08-20 10:00:00</div>
        <div class="content">
          <p>部署结果</p>
          <p><img src="files/deploy.png" alt="部署截图"></p>
          <p><img src="files/missing.png" alt="缺失图片"></p>
          <p><img src="../outside.png" alt="越界图片"></p>
          <p><img src="files/diagram.svg" alt="不支持格式"></p>
          <p><audio src="files/voice.mp3"></audio><video src="files/demo.mp4"></video></p>
        </div>
      </div>
    `)
    const writer = { addWorkLog, workLogExists }

    const summary = importFlomoMemos(parsed.memos, writer, { sourceRoot, attachmentRoot })

    expect(summary).toEqual({ imported: 1, skipped: 0, attachmentsImported: 1, attachmentsSkipped: 5 })
    const [log] = getWorkLogs()
    expect(log.content).toContain('![部署截图](workpulse-attachment://attachment/')
    expect(log.content).toContain('![缺失图片](files/missing.png)')
    expect(log.content).toContain('![越界图片](../outside.png)')
    expect(log.content).toContain('![不支持格式](files/diagram.svg)')

    const storedFiles = getDatabase().prepare("SELECT content FROM work_logs WHERE id = ?").get(log.id) as { content: string }
    expect(storedFiles.content).toBe(log.content)
    const attachmentUrl = log.content.match(/workpulse-attachment:\/\/attachment\/[^)]+/)?.[0]
    expect(attachmentUrl).toBeTruthy()
    const storedName = decodeURIComponent(new URL(attachmentUrl!).pathname.slice(1))
    expect(existsSync(join(attachmentRoot, storedName))).toBe(true)
    expect(readFileSync(join(attachmentRoot, storedName))).toEqual(Buffer.from([137, 80, 78, 71]))

    const secondSummary = importFlomoMemos(parsed.memos, { addWorkLog, workLogExists, listWorkLogs: getWorkLogs }, { sourceRoot, attachmentRoot })
    expect(secondSummary).toEqual({ imported: 0, skipped: 1, attachmentsImported: 0, attachmentsSkipped: 0 })
  })
})

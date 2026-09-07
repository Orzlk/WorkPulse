import Database from 'better-sqlite3'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { readAttachmentArchive } from '../../src/main/attachments/attachmentArchive'
import { runMigrations } from '../../src/main/database/migrations'
import { createWorkspaceBackup } from '../../src/main/database/workspaceBackup'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('workspace backup', () => {
  it('writes database data and every referenced attachment into a validated archive', async () => {
    const root = mkdtempSync(join(tmpdir(), 'workpulse-workspace-backup-'))
    directories.push(root)
    const attachmentRoot = join(root, 'attachments')
    const targetPath = join(root, 'backup.zip')
    const database = new Database(':memory:')
    runMigrations(database)
    const context = database.prepare('SELECT workspace_id, id AS user_id FROM users ORDER BY id LIMIT 1').get() as { workspace_id: number; user_id: number }
    database.prepare(`
      INSERT INTO work_logs (public_id, workspace_id, content, category, created_at, updated_at)
      VALUES ('backup-log', ?, '![image](workpulse-attachment://attachment/diagram.png)', '', '2026-09-07T00:00:00.000Z', '2026-09-07T00:00:00.000Z')
    `).run(context.workspace_id)
    mkdirSync(attachmentRoot)
    writeFileSync(join(attachmentRoot, 'diagram.png'), 'attachment-data')

    const result = await createWorkspaceBackup(database, context, attachmentRoot, targetPath)
    const entries = readAttachmentArchive(readFileSync(result.filePath))

    expect(existsSync(targetPath)).toBe(true)
    expect(result.attachments).toBe(1)
    expect(entries.map((entry) => entry.name)).toEqual(['data.json', 'attachments/diagram.png'])
    expect(entries[1].data.toString()).toBe('attachment-data')
    expect(entries[0].data.toString()).not.toContain('sync_operations')
    database.close()
  })
})

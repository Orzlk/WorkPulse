import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'

import { collectAttachmentNames, createAttachmentArchive, readAttachmentArchive, type AttachmentArchiveEntry } from '../attachments/attachmentArchive'
import type { WorkspaceContext } from '../repositories/contracts'
import { createDatabaseExport } from './transfer'

export async function createWorkspaceBackup(
  database: Database.Database,
  context: WorkspaceContext,
  attachmentRoot: string,
  targetPath: string
): Promise<{ filePath: string; attachments: number }> {
  const payload = createDatabaseExport(database, context)
  const entries: AttachmentArchiveEntry[] = [{ name: 'data.json', data: Buffer.from(JSON.stringify(payload), 'utf8') }]
  if (existsSync(attachmentRoot)) {
    for (const name of collectAttachmentNames(payload)) {
      const path = join(attachmentRoot, name)
      if (existsSync(path) && statSync(path).isFile()) entries.push({ name: `attachments/${name}`, data: readFileSync(path) })
    }
  }
  const archive = createAttachmentArchive(entries)
  const temporaryPath = `${targetPath}.${randomUUID()}.tmp`
  mkdirSync(dirname(targetPath), { recursive: true })
  try {
    writeFileSync(temporaryPath, archive, { flag: 'wx' })
    readAttachmentArchive(readFileSync(temporaryPath))
    renameSync(temporaryPath, targetPath)
  } catch (error) {
    rmSync(temporaryPath, { force: true })
    throw error
  }
  return { filePath: targetPath, attachments: entries.length - 1 }
}

import Database from 'better-sqlite3'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

import { getDatabaseVersion, runMigrations } from './migrations'

export { getDatabaseVersion, runMigrations }

export function openDatabase(path: string): Database.Database {
  const directory = dirname(path)
  if (!existsSync(directory)) {
    mkdirSync(directory, { recursive: true })
  }

  const database = new Database(path)
  database.pragma('journal_mode = WAL')
  database.pragma('foreign_keys = ON')
  database.pragma('busy_timeout = 5000')
  return database
}

export async function backupDatabase(
  database: Database.Database,
  targetPath: string
): Promise<void> {
  const directory = dirname(targetPath)
  if (!existsSync(directory)) {
    mkdirSync(directory, { recursive: true })
  }

  await database.backup(targetPath)

  const backup = new Database(targetPath, { readonly: true })
  try {
    const result = backup.pragma('integrity_check') as Array<{ integrity_check: string }>
    if (result[0]?.integrity_check !== 'ok') {
      throw new Error(`Backup integrity check failed: ${targetPath}`)
    }
  } finally {
    backup.close()
  }
}

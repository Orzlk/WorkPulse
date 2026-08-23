import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

import { getDatabaseVersion, runMigrations } from './migrations'

export { getDatabaseVersion, runMigrations }

export async function initializeDatabase(
  path: string,
  backup: (database: Database.Database) => Promise<void>,
  migrate: (database: Database.Database) => void
): Promise<Database.Database> {
  const existedBeforeStartup = existsSync(path)
  const database = openDatabase(path)

  try {
    if (existedBeforeStartup) {
      await backup(database)
    }
    migrate(database)
    return database
  } catch (error) {
    database.close()
    throw error
  }
}

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

  const temporaryPath = join(
    directory,
    `.${basename(targetPath)}.tmp-${Date.now()}-${randomUUID()}`
  )
  try {
    await database.backup(temporaryPath)

    const backup = new Database(temporaryPath, { readonly: true })
    try {
      const result = backup.pragma('integrity_check') as Array<{ integrity_check: string }>
      if (result[0]?.integrity_check !== 'ok') {
        throw new Error(`Backup integrity check failed: ${targetPath}`)
      }
    } finally {
      backup.close()
    }

    renameSync(temporaryPath, targetPath)
  } catch (error) {
    if (existsSync(temporaryPath)) {
      rmSync(temporaryPath, { force: true })
    }
    throw error
  }
}

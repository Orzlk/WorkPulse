import type Database from 'better-sqlite3'

export interface SchemaMigration {
  version: number
  name: string
  up: (database: Database.Database) => void
}

export interface SchemaMigrationRecord {
  version: number
  name: string
  applied_at: string
}

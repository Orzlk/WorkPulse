import type Database from 'better-sqlite3'

export interface SchemaMigration {
  version: number
  name: string
  up: (database: Database.Database, context: MigrationContext) => void
}

export interface MigrationContext {
  now: () => Date
}

export interface SchemaMigrationRecord {
  version: number
  name: string
  applied_at: string
}

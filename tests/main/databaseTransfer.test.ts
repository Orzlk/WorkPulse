import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

import { runMigrations } from '../../src/main/database/migrations'
import {
  createDatabaseExport,
  mergeDatabaseImport,
  previewDatabaseImport,
  type DatabaseTransferPackage
} from '../../src/main/database/transfer'

function createDatabase(): Database.Database {
  const database = new Database(':memory:')
  runMigrations(database)
  return database
}

function context(database: Database.Database): { workspace_id: number; user_id: number } {
  return database.prepare('SELECT workspace_id, id AS user_id FROM users ORDER BY id LIMIT 1').get() as {
    workspace_id: number
    user_id: number
  }
}

describe('database transfer package', () => {
  it('exports a versioned package without settings or API keys', () => {
    const database = createDatabase()
    const { workspace_id, user_id } = context(database)
    database.prepare(`INSERT INTO settings (key, value, public_id, workspace_id, created_by, updated_by, created_at, updated_at)
      VALUES ('api_key', 'secret-value', 'setting-1', ?, ?, ?, '2026-08-23T00:00:00.000Z', '2026-08-23T00:00:00.000Z')`)
      .run(workspace_id, user_id, user_id)
    database.prepare(`INSERT INTO projects (public_id, workspace_id, name, description, color, created_by, updated_by, created_at, updated_at)
      VALUES ('project-1', ?, '项目', '', '#111111', ?, ?, '2026-08-23T00:00:00.000Z', '2026-08-23T00:00:00.000Z')`)
      .run(workspace_id, user_id, user_id)

    const exported = createDatabaseExport(database, context(database))

    expect(exported.schema_version).toBe(10)
    expect(exported.tables.projects).toHaveLength(1)
    expect(JSON.stringify(exported)).not.toContain('secret-value')
    expect(exported.tables.settings).toBeUndefined()
    expect(exported.tables.projects?.[0]).not.toHaveProperty('future_secret')
    expect(JSON.stringify(exported)).not.toContain('local_path')
    database.close()
  })

  it('rejects unknown input columns, unsupported future schema and oversized exports', () => {
    const database = createDatabase()
    const packageWithSecret = createDatabaseExport(database, context(database)) as DatabaseTransferPackage
    packageWithSecret.tables.projects = [{
      id: 1,
      public_id: 'project-future',
      name: '项目',
      description: '',
      color: '#111111',
      created_at: '2026-08-23T00:00:00.000Z',
      updated_at: '2026-08-23T00:00:00.000Z',
      future_secret: 'do-not-ignore'
    }]
    expect(() => previewDatabaseImport(packageWithSecret)).toThrow('IMPORT_INVALID')
    expect(() => previewDatabaseImport({ ...packageWithSecret, schema_version: 11 })).toThrow('IMPORT_INVALID')

    database.prepare(`INSERT INTO work_logs (public_id, workspace_id, content, created_at, updated_at)
      VALUES ('large-log', ?, ?, '2026-08-23T00:00:00.000Z', '2026-08-23T00:00:00.000Z')`)
      .run(context(database).workspace_id, 'x'.repeat(20 * 1024 * 1024))
    expect(() => createDatabaseExport(database, context(database))).toThrow('IMPORT_TOO_LARGE')
    database.close()
  })

  it('previews then merges public ids without overwriting or duplicating rows', () => {
    const source = createDatabase()
    const sourceContext = context(source)
    source.prepare(`INSERT INTO projects (public_id, workspace_id, name, description, color, created_by, updated_by, created_at, updated_at)
      VALUES ('project-1', ?, '导入项目', '', '#111111', ?, ?, '2026-08-23T00:00:00.000Z', '2026-08-23T00:00:00.000Z')`)
      .run(sourceContext.workspace_id, sourceContext.user_id, sourceContext.user_id)
    const packageData = createDatabaseExport(source, sourceContext)

    const target = createDatabase()
    expect(previewDatabaseImport(packageData).records.projects).toBe(1)
    expect(mergeDatabaseImport(target, context(target), packageData).inserted).toBe(1)
    expect(mergeDatabaseImport(target, context(target), packageData)).toMatchObject({ inserted: 0, conflicts: 1 })
    expect(target.prepare("SELECT name FROM projects WHERE public_id = 'project-1'").get()).toEqual({ name: '导入项目' })
    source.close()
    target.close()
  })

  it('imports repository bindings as unavailable without probing their local paths', () => {
    const source = createDatabase()
    const sourceContext = context(source)
    source.prepare(`INSERT INTO repositories (public_id, workspace_id, name, enabled, created_by, updated_by, created_at, updated_at)
      VALUES ('repository-1', ?, 'repo', 1, ?, ?, '2026-08-23T00:00:00.000Z', '2026-08-23T00:00:00.000Z')`)
      .run(sourceContext.workspace_id, sourceContext.user_id, sourceContext.user_id)
    const repositoryId = (source.prepare("SELECT id FROM repositories WHERE public_id = 'repository-1'").get() as { id: number }).id
    source.prepare(`INSERT INTO repository_bindings (public_id, repository_id, workspace_id, local_path, is_valid, created_by, updated_by, created_at, updated_at)
      VALUES ('binding-1', ?, ?, 'Z:/unknown-path', 1, ?, ?, '2026-08-23T00:00:00.000Z', '2026-08-23T00:00:00.000Z')`)
      .run(repositoryId, sourceContext.workspace_id, sourceContext.user_id, sourceContext.user_id)

    const target = createDatabase()
    mergeDatabaseImport(target, context(target), createDatabaseExport(source, sourceContext))
    expect(target.prepare("SELECT is_valid FROM repository_bindings WHERE public_id = 'binding-1'").get()).toEqual({ is_valid: 0 })
    source.close()
    target.close()
  })

  it('rejects malformed packages before writes and rolls back a failed merge', () => {
    const database = createDatabase()
    const packageData: DatabaseTransferPackage = {
      format: 'workpulse-data',
      format_version: 1,
      schema_version: 9,
      exported_at: '2026-08-23T00:00:00.000Z',
      tables: {
        projects: [{ public_id: 'project-1', name: 'invalid missing timestamps' }]
      }
    }

    expect(() => previewDatabaseImport({ format: 'unknown' })).toThrow('IMPORT_INVALID')
    expect(() => mergeDatabaseImport(database, context(database), packageData)).toThrow('IMPORT_INVALID')
    expect(database.prepare('SELECT COUNT(*) AS count FROM projects').get()).toEqual({ count: 0 })
    database.close()
  })
})

import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

import { collectWorkspaceAttachmentReferences } from '../../src/main/attachments/attachmentReferences'

describe('workspace attachment references', () => {
  it('reads attachment-bearing fields without constructing an export package', () => {
    const database = new Database(':memory:')
    database.exec(`
      CREATE TABLE work_logs (content TEXT, workspace_id INTEGER);
      CREATE TABLE tasks (title TEXT, description TEXT, checklist TEXT, workspace_id INTEGER);
      CREATE TABLE inbox_items (content TEXT, ai_suggestion TEXT, workspace_id INTEGER);
      CREATE TABLE reports (content TEXT, source_snapshot TEXT, workspace_id INTEGER);
    `)
    database.prepare('INSERT INTO work_logs VALUES (?, ?)').run('see workpulse-attachment://attachment/log.png', 1)
    database.prepare('INSERT INTO tasks VALUES (?, ?, ?, ?)').run('task', '', '[]', 1)
    database.prepare('INSERT INTO inbox_items VALUES (?, ?, ?)').run('inbox', '{"image":"workpulse-attachment://attachment/inbox.png"}', 1)
    database.prepare('INSERT INTO reports VALUES (?, ?, ?)').run('', '{"image":"workpulse-attachment://attachment/report.png"}', 1)

    expect(collectWorkspaceAttachmentReferences(database, { workspace_id: 1, user_id: 1 })).toEqual(new Set(['log.png', 'inbox.png', 'report.png']))
    database.close()
  })
})

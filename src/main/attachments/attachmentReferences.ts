import type Database from 'better-sqlite3'

import { collectAttachmentNames } from './attachmentArchive'
import type { WorkspaceContext } from '../repositories/contracts'

/** Collect only attachment-bearing fields used by startup cleanup. */
export function collectWorkspaceAttachmentReferences(database: Database.Database, context: WorkspaceContext): Set<string> {
  const references = new Set<string>()
  const query = database.prepare(`
    SELECT content AS value FROM work_logs WHERE workspace_id = ?
    UNION ALL SELECT title AS value FROM tasks WHERE workspace_id = ?
    UNION ALL SELECT description AS value FROM tasks WHERE workspace_id = ?
    UNION ALL SELECT checklist AS value FROM tasks WHERE workspace_id = ?
    UNION ALL SELECT content AS value FROM inbox_items WHERE workspace_id = ?
    UNION ALL SELECT ai_suggestion AS value FROM inbox_items WHERE workspace_id = ?
    UNION ALL SELECT content AS value FROM reports WHERE workspace_id = ?
    UNION ALL SELECT source_snapshot AS value FROM reports WHERE workspace_id = ?
  `)
  for (const row of query.all(
    context.workspace_id, context.workspace_id, context.workspace_id, context.workspace_id,
    context.workspace_id, context.workspace_id, context.workspace_id, context.workspace_id
  ) as Array<{ value: unknown }>) {
    for (const name of collectAttachmentNames(row.value)) references.add(name)
  }
  return references
}

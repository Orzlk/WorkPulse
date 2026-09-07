import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'

export type OutboxOperationType = 'create' | 'update' | 'delete'
export type OutboxAction = OutboxOperationType | 'restore'

export interface OutboxOperationInput {
  entity: string
  publicId: string
  operationType: OutboxOperationType
  action?: OutboxAction
  version?: number
  changedAt: string
  data: unknown
  operationId?: string
}

export interface OutboxPayload {
  entity: string
  public_id: string
  version: number
  changed_at: string
  data: unknown
  action: OutboxAction
}

export interface SerializedOutboxOperation {
  operationType: OutboxOperationType
  payload: OutboxPayload
}

export function serializeOutboxOperation(input: OutboxOperationInput): SerializedOutboxOperation {
  const version = input.version ?? 1
  if (!Number.isInteger(version) || version < 1) throw new Error('Outbox version must be a positive integer')
  return {
    operationType: input.operationType,
    payload: {
      entity: input.entity,
      public_id: input.publicId,
      version,
      changed_at: input.changedAt,
      data: input.data,
      action: input.action ?? input.operationType
    }
  }
}

export function enqueueOutbox(
  database: Database.Database,
  workspaceId: number,
  input: OutboxOperationInput
): void {
  const serialized = serializeOutboxOperation(input)
  database.prepare(`
    INSERT INTO sync_operations (
      public_id, workspace_id, entity_type, entity_public_id, operation_type,
      payload, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.operationId ?? randomUUID(),
    workspaceId,
    serialized.payload.entity,
    serialized.payload.public_id,
    serialized.operationType,
    JSON.stringify(serialized.payload),
    serialized.payload.changed_at,
    serialized.payload.changed_at
  )
}

export function getPendingOutboxCount(database: Database.Database, workspaceId: number): number {
  const row = database.prepare(`
    SELECT COUNT(*) AS count
    FROM sync_operations
    WHERE workspace_id = ? AND completed_at IS NULL AND failed_at IS NULL
  `).get(workspaceId) as { count: number }
  return row.count
}

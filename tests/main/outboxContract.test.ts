import { describe, expect, it } from 'vitest'
import { serializeOutboxOperation } from '../../src/main/sync/outbox'

describe('outbox contract', () => {
  it('uses one envelope for create, update and delete operations', () => {
    const operation = serializeOutboxOperation({
      entity: 'work_log',
      publicId: 'log-1',
      operationType: 'create',
      changedAt: '2026-09-07T00:00:00.000Z',
      data: { content: 'hello' }
    })

    expect(operation.operationType).toBe('create')
    expect(operation.payload).toEqual({
      entity: 'work_log',
      public_id: 'log-1',
      version: 1,
      changed_at: '2026-09-07T00:00:00.000Z',
      data: { content: 'hello' },
      action: 'create'
    })
  })

  it('keeps restore as an update with an explicit restore action', () => {
    const operation = serializeOutboxOperation({
      entity: 'tag',
      publicId: 'tag-1',
      operationType: 'update',
      action: 'restore',
      changedAt: '2026-09-07T00:00:00.000Z',
      data: { deleted_at: null }
    })

    expect(operation.operationType).toBe('update')
    expect(operation.payload.action).toBe('restore')
    expect(operation.payload.entity).toBe('tag')
    expect(operation.payload.public_id).toBe('tag-1')
  })
})

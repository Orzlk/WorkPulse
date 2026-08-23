import { randomUUID } from 'node:crypto'

import type Database from 'better-sqlite3'

import type { Page, Tag } from '../domain/types'
import type { Pagination, WorkspaceContext } from '../repositories/contracts'
import { LocalTagRepository } from '../repositories/localTagRepository'

export class TagService {
  private readonly tags: LocalTagRepository

  constructor(private readonly database: Database.Database, private readonly context: WorkspaceContext) {
    this.tags = new LocalTagRepository(database)
  }

  list(pagination?: Pagination): Page<Tag> {
    this.assertWorkspace()
    return this.tags.list(this.context, pagination)
  }

  create(name: string): Tag {
    this.assertWorkspace()
    const create = this.database.transaction(() => {
      const tag = this.tags.create(this.context, name)
      this.enqueue('create', tag)
      return tag
    })
    return create()
  }

  rename(publicId: string, name: string): Tag | null {
    this.assertWorkspace()
    const rename = this.database.transaction(() => {
      const tag = this.tags.update(this.context, publicId, name)
      if (tag) this.enqueue('update', tag)
      return tag
    })
    return rename()
  }

  search(query: string, pagination?: Pagination): Page<Tag> {
    const result = this.list({ limit: 200, offset: 0 })
    const normalized = query.trim().toLowerCase()
    const limit = Math.min(Math.max(pagination?.limit ?? 50, 1), 200)
    const offset = Math.max(pagination?.offset ?? 0, 0)
    const items = normalized ? result.items.filter((tag) => tag.path.includes(normalized)) : result.items
    return { items: items.slice(offset, offset + limit), total: items.length }
  }

  private enqueue(operationType: 'create' | 'update', tag: Tag): void {
    const now = new Date().toISOString()
    this.database.prepare(`
      INSERT INTO sync_operations (
        public_id, workspace_id, entity_type, entity_public_id, operation_type, payload, created_at, updated_at
      ) VALUES (?, ?, 'tag', ?, ?, ?, ?, ?)
    `).run(randomUUID(), this.context.workspace_id, tag.public_id, operationType, JSON.stringify(tag), now, now)
  }

  private assertWorkspace(): void {
    const workspace = this.database.prepare(`
      SELECT 1 FROM workspaces INNER JOIN users ON users.workspace_id = workspaces.id
      WHERE workspaces.id = ? AND users.id = ? AND workspaces.deleted_at IS NULL AND users.deleted_at IS NULL
    `).get(this.context.workspace_id, this.context.user_id)
    if (!workspace) throw new Error('Workspace not found')
  }
}

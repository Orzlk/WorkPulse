import type Database from 'better-sqlite3'

import type { Page, Tag } from '../domain/types'
import type { Pagination, WorkspaceContext } from '../repositories/contracts'
import { LocalTagRepository } from '../repositories/localTagRepository'
import { enqueueOutbox } from '../sync/outbox'

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
    const all: Tag[] = []
    let pageOffset = 0
    let total = 0
    do {
      const page = this.list({ limit: 200, offset: pageOffset })
      all.push(...page.items)
      total = page.total
      pageOffset += page.items.length
      if (page.items.length === 0) break
    } while (pageOffset < total)
    const normalized = query.trim().toLowerCase()
    const limit = Math.min(Math.max(pagination?.limit ?? 50, 1), 200)
    const offset = Math.max(pagination?.offset ?? 0, 0)
    const items = normalized ? all.filter((tag) => tag.path.includes(normalized)) : all
    return { items: items.slice(offset, offset + limit), total: items.length }
  }

  private enqueue(operationType: 'create' | 'update', tag: Tag): void {
    const now = new Date().toISOString()
    enqueueOutbox(this.database, this.context.workspace_id, {
      entity: 'tag',
      publicId: tag.public_id,
      operationType,
      changedAt: now,
      data: tag
    })
  }

  private assertWorkspace(): void {
    const workspace = this.database.prepare(`
      SELECT 1 FROM workspaces INNER JOIN users ON users.workspace_id = workspaces.id
      WHERE workspaces.id = ? AND users.id = ? AND workspaces.deleted_at IS NULL AND users.deleted_at IS NULL
    `).get(this.context.workspace_id, this.context.user_id)
    if (!workspace) throw new Error('Workspace not found')
  }
}

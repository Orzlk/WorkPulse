import { randomUUID } from 'node:crypto'

import type Database from 'better-sqlite3'

import type { InboxItem, InboxSuggestion, InboxTarget, Page } from '../domain/types'
import type { Pagination, WorkspaceContext } from '../repositories/contracts'
import { LocalInboxRepository } from '../repositories/localInboxRepository'
import { LocalTagRepository, normalizeTagName } from '../repositories/localTagRepository'

export interface CreateInboxInput {
  content: string
  project_id?: string | null
  repository_id?: string | null
  tag_names?: string[]
  include_in_reports?: boolean
  ai_suggestion?: InboxSuggestion | null
}

export interface InboxConfirmation {
  target: InboxTarget
  target_public_id: string | null
}

export class InboxService {
  private readonly inbox: LocalInboxRepository
  private readonly tags: LocalTagRepository

  constructor(
    private readonly database: Database.Database,
    private readonly context: WorkspaceContext
  ) {
    this.inbox = new LocalInboxRepository(database)
    this.tags = new LocalTagRepository(database)
  }

  create(input: CreateInboxInput): InboxItem {
    this.assertWorkspace()
    if (!input.content) throw new Error('Inbox content is required')
    this.assertProject(input.project_id ?? null)
    this.assertRepository(input.repository_id ?? null)
    const suggestion = this.validateSuggestion(input.ai_suggestion ?? null)
    const create = this.database.transaction(() => {
      const now = new Date().toISOString()
      const item = this.inbox.create(this.context, {
        public_id: randomUUID(),
        content: input.content,
        project_id: input.project_id ?? null,
        repository_id: input.repository_id ?? null,
        state: 'unorganized',
        include_in_reports: input.include_in_reports ?? true,
        ai_suggestion: suggestion,
        created_at: now,
        updated_at: now
      })
      const inboxId = this.inbox.getInternalId(this.context, item.public_id)
      if (inboxId === null) throw new Error('Inbox item was not created')
      this.assignTags(
        'inbox_item',
        item.public_id,
        input.tag_names ?? [],
        (tag) => this.tags.assignToInbox(this.context, inboxId, tag)
      )
      this.updateSearchIndex(inboxId, item.content)
      this.enqueueSync('inbox_item', item.public_id, 'create', item)
      return item
    })
    return create()
  }

  list(pagination?: Pagination): Page<InboxItem> {
    this.assertWorkspace()
    return this.inbox.list(this.context, pagination)
  }

  get(publicId: string): InboxItem | null {
    this.assertWorkspace()
    return this.inbox.get(this.context, publicId)
  }

  update(publicId: string, input: Omit<Partial<CreateInboxInput>, 'content' | 'tag_names'>): InboxItem | null {
    this.assertWorkspace()
    this.assertProject(input.project_id ?? null)
    this.assertRepository(input.repository_id ?? null)
    const suggestion = input.ai_suggestion === undefined ? undefined : this.validateSuggestion(input.ai_suggestion)
    const update = this.database.transaction(() => {
      const item = this.inbox.update(this.context, publicId, {
        project_id: input.project_id,
        repository_id: input.repository_id,
        include_in_reports: input.include_in_reports,
        ai_suggestion: suggestion
      })
      if (item) this.enqueueSync('inbox_item', item.public_id, 'update', item)
      return item
    })
    return update()
  }

  ignore(publicId: string): InboxItem | null {
    return this.setState(publicId, 'ignored')
  }

  archive(publicId: string): InboxItem | null {
    return this.setState(publicId, 'archived')
  }

  confirm(publicId: string): InboxConfirmation {
    this.assertWorkspace()
    const confirm = this.database.transaction(() => {
      const item = this.inbox.get(this.context, publicId)
      if (!item) throw new Error('Inbox item not found')
      if (item.state !== 'unorganized') throw new Error('Inbox item is already organized')
      if (!item.ai_suggestion) throw new Error('Inbox suggestion is required')
      const suggestion = this.validateSuggestion(item.ai_suggestion)
      if (!suggestion) throw new Error('Inbox suggestion is required')
      if (suggestion.target === 'ignore') {
        const ignored = this.inbox.update(this.context, publicId, {
          state: 'ignored',
          include_in_reports: suggestion.include_in_reports
        })
        if (!ignored) throw new Error('Inbox item not found')
        this.enqueueSync('inbox_item', publicId, 'update', ignored)
        return { target: 'ignore' as const, target_public_id: null }
      }

      const target = suggestion.target === 'work_log'
        ? this.createWorkLog(item, suggestion)
        : this.createTask(item, suggestion)
      const updated = this.inbox.update(this.context, publicId, {
        state: 'confirmed',
        include_in_reports: suggestion.include_in_reports
      })
      if (!updated) throw new Error('Inbox item not found')
      this.enqueueSync('inbox_item', publicId, 'update', updated)
      return target
    })
    return confirm()
  }

  private createWorkLog(item: InboxItem, suggestion: InboxSuggestion): InboxConfirmation {
    const now = new Date().toISOString()
    const publicId = randomUUID()
    const row = this.database.prepare(`
      INSERT INTO work_logs (
        content, category, task_id, project_id, repository_id,
        created_at, updated_at, public_id, workspace_id, created_by, updated_by
      ) VALUES (
        ?, '', NULL,
        (SELECT id FROM projects WHERE workspace_id = ? AND public_id = ? AND deleted_at IS NULL),
        (SELECT id FROM repositories WHERE workspace_id = ? AND public_id = ? AND deleted_at IS NULL),
        ?, ?, ?, ?, ?, ?
      ) RETURNING id, public_id
    `).get(
      item.content,
      this.context.workspace_id,
      suggestion.project_id,
      this.context.workspace_id,
      suggestion.repository_id,
      now,
      now,
      publicId,
      this.context.workspace_id,
      this.context.user_id,
      this.context.user_id
    ) as { id: number; public_id: string }
    this.assignTags(
      'work_log',
      row.public_id,
      suggestion.tag_names,
      (tag) => this.tags.assignToWorkLog(this.context, row.id, tag)
    )
    this.enqueueSync('work_log', row.public_id, 'create', {
      public_id: row.public_id,
      content: item.content,
      project_id: suggestion.project_id,
      repository_id: suggestion.repository_id
    })
    return { target: 'work_log', target_public_id: row.public_id }
  }

  private setState(publicId: string, state: 'ignored' | 'archived'): InboxItem | null {
    this.assertWorkspace()
    const update = this.database.transaction(() => {
      const item = this.inbox.update(this.context, publicId, { state })
      if (item) this.enqueueSync('inbox_item', item.public_id, 'update', item)
      return item
    })
    return update()
  }

  private createTask(item: InboxItem, suggestion: InboxSuggestion): InboxConfirmation {
    const now = new Date().toISOString()
    const publicId = randomUUID()
    const position = this.database.prepare(`
      SELECT COALESCE(MAX(position), -1) + 1 AS next
      FROM tasks
      WHERE workspace_id = ? AND deleted_at IS NULL AND status = 'todo'
    `).get(this.context.workspace_id) as { next: number }
    const row = this.database.prepare(`
      INSERT INTO tasks (
        title, description, status, board_column, position, project_id, repository_id,
        created_at, updated_at, public_id, workspace_id, created_by, updated_by
      ) VALUES (
        ?, ?, 'todo', 'todo', ?,
        (SELECT id FROM projects WHERE workspace_id = ? AND public_id = ? AND deleted_at IS NULL),
        (SELECT id FROM repositories WHERE workspace_id = ? AND public_id = ? AND deleted_at IS NULL),
        ?, ?, ?, ?, ?, ?
      ) RETURNING id, public_id
    `).get(
      suggestion.title || item.content,
      item.content,
      position.next,
      this.context.workspace_id,
      suggestion.project_id,
      this.context.workspace_id,
      suggestion.repository_id,
      now,
      now,
      publicId,
      this.context.workspace_id,
      this.context.user_id,
      this.context.user_id
    ) as { id: number; public_id: string }
    this.assignTags(
      'task',
      row.public_id,
      suggestion.tag_names,
      (tag) => this.tags.assignToTask(this.context, row.id, tag)
    )
    this.enqueueSync('task', row.public_id, 'create', {
      public_id: row.public_id,
      title: suggestion.title || item.content,
      description: item.content,
      project_id: suggestion.project_id,
      repository_id: suggestion.repository_id
    })
    return { target: 'task', target_public_id: row.public_id }
  }

  private assignTags(
    recordType: 'inbox_item' | 'work_log' | 'task',
    recordPublicId: string,
    names: string[],
    assign: (tag: ReturnType<LocalTagRepository['create']>) => void
  ): void {
    for (const name of Array.from(new Set(names.map(normalizeTagName)))) {
      const existing = this.database.prepare(`
        SELECT public_id FROM tags
        WHERE workspace_id = ? AND path = ? AND deleted_at IS NULL
      `).get(this.context.workspace_id, name) as { public_id: string } | undefined
      const tag = existing
        ? this.tags.get(this.context, existing.public_id)
        : this.tags.create(this.context, name)
      if (!tag) throw new Error('Tag not found')
      if (!existing) this.enqueueSync('tag', tag.public_id, 'create', tag)
      assign(tag)
      this.enqueueTagAssignment(recordType, recordPublicId, tag.public_id)
    }
  }

  private enqueueTagAssignment(
    recordType: 'inbox_item' | 'work_log' | 'task',
    recordPublicId: string,
    tagPublicId: string
  ): void {
    const operationPublicId = `${recordPublicId}:tag:${tagPublicId}`
    const now = new Date().toISOString()
    this.database.prepare(`
      INSERT OR IGNORE INTO sync_operations (
        public_id, workspace_id, entity_type, entity_public_id, operation_type,
        payload, created_at, updated_at
      ) VALUES (?, ?, 'tag_assignment', ?, 'attach', ?, ?, ?)
    `).run(
      operationPublicId,
      this.context.workspace_id,
      operationPublicId,
      JSON.stringify({
        record_type: recordType,
        entity_type: recordType,
        record_public_id: recordPublicId,
        tag_public_id: tagPublicId,
        action: 'attach'
      }),
      now,
      now
    )
  }

  private updateSearchIndex(inboxId: number, content: string): void {
    this.database.prepare(`
      DELETE FROM content_search
      WHERE entity_type = 'inbox_item' AND entity_id = ? AND workspace_id = ?
    `).run(String(inboxId), this.context.workspace_id)
    this.database.prepare(`
      INSERT INTO content_search (entity_type, entity_id, workspace_id, content)
      VALUES ('inbox_item', ?, ?, ?)
    `).run(String(inboxId), this.context.workspace_id, content)
  }

  private validateSuggestion(suggestion: InboxSuggestion | null): InboxSuggestion | null {
    if (!suggestion) return null
    if (!['work_log', 'task', 'ignore'].includes(suggestion.target)) {
      throw new Error('Inbox suggestion target is invalid')
    }
    this.assertProject(suggestion.project_id)
    this.assertRepository(suggestion.repository_id)
    return {
      ...suggestion,
      title: suggestion.title,
      summary: suggestion.summary,
      tag_names: Array.from(new Set(suggestion.tag_names.map(normalizeTagName))),
      include_in_reports: Boolean(suggestion.include_in_reports)
    }
  }

  private assertWorkspace(): void {
    const row = this.database.prepare(`
      SELECT 1
      FROM workspaces
      INNER JOIN users ON users.workspace_id = workspaces.id
      WHERE workspaces.id = ? AND users.id = ?
        AND workspaces.deleted_at IS NULL AND users.deleted_at IS NULL
    `).get(this.context.workspace_id, this.context.user_id)
    if (!row) throw new Error('Workspace not found')
  }

  private assertProject(publicId: string | null): void {
    if (!publicId) return
    const row = this.database.prepare(`
      SELECT 1 FROM projects
      WHERE workspace_id = ? AND public_id = ? AND deleted_at IS NULL
    `).get(this.context.workspace_id, publicId)
    if (!row) throw new Error('Project not found')
  }

  private assertRepository(publicId: string | null): void {
    if (!publicId) return
    const row = this.database.prepare(`
      SELECT 1 FROM repositories
      WHERE workspace_id = ? AND public_id = ? AND deleted_at IS NULL
    `).get(this.context.workspace_id, publicId)
    if (!row) throw new Error('Repository not found')
  }

  private enqueueSync(
    entityType: string,
    entityPublicId: string,
    operationType: 'create' | 'update' | 'delete',
    payload: unknown
  ): void {
    const now = new Date().toISOString()
    this.database.prepare(`
      INSERT INTO sync_operations (
        public_id, workspace_id, entity_type, entity_public_id, operation_type,
        payload, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      this.context.workspace_id,
      entityType,
      entityPublicId,
      operationType,
      JSON.stringify(payload),
      now,
      now
    )
  }
}

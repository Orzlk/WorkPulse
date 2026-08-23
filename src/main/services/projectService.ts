import { randomUUID } from 'node:crypto'

import type Database from 'better-sqlite3'

import type { Page, Project } from '../domain/types'
import type { Pagination, ReadOptions, WorkspaceContext } from '../repositories/contracts'
import { LocalProjectRepository } from '../repositories/localProjectRepository'

export class ProjectService {
  private readonly projects: LocalProjectRepository

  constructor(
    private readonly database: Database.Database,
    private readonly context: WorkspaceContext
  ) {
    this.projects = new LocalProjectRepository(database)
  }

  list(pagination?: Pagination): Page<Project> {
    this.assertWorkspace()
    return this.projects.list(this.context, pagination)
  }

  get(publicId: string, options?: ReadOptions): Project | null {
    this.assertWorkspace()
    return this.projects.get(this.context, publicId, options)
  }

  create(input: Omit<Project, 'public_id' | 'archived_at'>): Project {
    this.assertWorkspace()
    if (!input.name.trim()) throw new Error('Project name is required')
    const create = this.database.transaction(() => {
      const project = this.projects.create(this.context, {
        name: input.name.trim(),
        description: input.description,
        color: input.color
      })
      this.enqueueSync('project', project.public_id, 'create', project)
      return project
    })
    return create()
  }

  update(publicId: string, input: Partial<Omit<Project, 'public_id' | 'archived_at'>>): Project | null {
    this.assertWorkspace()
    const update = this.database.transaction(() => {
      const project = this.projects.update(this.context, publicId, input)
      if (project) this.enqueueSync('project', project.public_id, 'update', project)
      return project
    })
    return update()
  }

  softDelete(publicId: string): Project | null {
    this.assertWorkspace()
    const remove = this.database.transaction(() => {
      const project = this.projects.softDelete(this.context, publicId)
      if (project) this.enqueueSync('project', project.public_id, 'delete', project)
      return project
    })
    return remove()
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

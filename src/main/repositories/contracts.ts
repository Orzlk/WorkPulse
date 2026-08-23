import type { InboxItem, Page, Project, Tag } from '../domain/types'

export interface WorkspaceContext {
  workspace_id: number
  user_id: number
}

export interface Pagination {
  limit?: number
  offset?: number
}

export interface ReadOptions {
  includeDeleted?: boolean
}

export interface ProjectRepository {
  list(context: WorkspaceContext, pagination?: Pagination): Page<Project>
  get(context: WorkspaceContext, publicId: string, options?: ReadOptions): Project | null
  create(context: WorkspaceContext, input: Omit<Project, 'public_id' | 'archived_at'>): Project
  update(context: WorkspaceContext, publicId: string, input: Partial<Omit<Project, 'public_id' | 'archived_at'>>): Project | null
  softDelete(context: WorkspaceContext, publicId: string): Project | null
}

export interface InboxRepository {
  list(context: WorkspaceContext, pagination?: Pagination): Page<InboxItem>
  get(context: WorkspaceContext, publicId: string, options?: ReadOptions): InboxItem | null
  create(context: WorkspaceContext, input: InboxItem): InboxItem
  update(context: WorkspaceContext, publicId: string, input: Partial<InboxItem>): InboxItem | null
  softDelete(context: WorkspaceContext, publicId: string): InboxItem | null
}

export interface TagRepository {
  list(context: WorkspaceContext, pagination?: Pagination): Page<Tag>
  get(context: WorkspaceContext, publicId: string, options?: ReadOptions): Tag | null
  create(context: WorkspaceContext, name: string): Tag
  update(context: WorkspaceContext, publicId: string, name: string): Tag | null
  softDelete(context: WorkspaceContext, publicId: string): Tag | null
}

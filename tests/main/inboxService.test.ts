import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { openDatabase, runMigrations } from '../../src/main/database/connection'
import type { WorkspaceContext } from '../../src/main/repositories/contracts'
import { LocalInboxRepository } from '../../src/main/repositories/localInboxRepository'
import { LocalProjectRepository } from '../../src/main/repositories/localProjectRepository'
import { LocalTagRepository } from '../../src/main/repositories/localTagRepository'
import { InboxService } from '../../src/main/services/inboxService'
import { ProjectService } from '../../src/main/services/projectService'
import { SearchService } from '../../src/main/services/searchService'

const temporaryDirectories: string[] = []

function createDatabase(): { database: Database.Database; context: WorkspaceContext } {
  const directory = mkdtempSync(join(tmpdir(), 'workpulse-inbox-'))
  temporaryDirectories.push(directory)
  const database = openDatabase(join(directory, 'workpulse.db'))
  runMigrations(database)
  const context = database.prepare(`
    SELECT workspaces.id AS workspace_id, users.id AS user_id
    FROM workspaces
    INNER JOIN users ON users.workspace_id = workspaces.id
    WHERE workspaces.deleted_at IS NULL AND users.deleted_at IS NULL
    ORDER BY workspaces.id, users.id
    LIMIT 1
  `).get() as WorkspaceContext
  return { database, context }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    try {
      rmSync(directory, { force: true, recursive: true })
    } catch {
      // SQLite 在 Windows 上失败断言后可能暂时保留文件句柄。
    }
  }
})

describe('项目、收件箱和标签服务', () => {
  it('拒绝把收件箱归属到当前工作区不存在的项目', () => {
    const { database, context } = createDatabase()
    const inboxService = new InboxService(database, context)

    expect(() => inboxService.create({
      content: '保留这段原文',
      project_id: 'missing-project'
    })).toThrow('Project not found')

    expect(database.prepare('SELECT COUNT(*) AS count FROM inbox_items').get()).toEqual({ count: 0 })
    database.close()
  })

  it('确认建议前不创建目标，确认后保留原始内容并只创建一个日志', () => {
    const { database, context } = createDatabase()
    const projects = new ProjectService(database, context)
    const inboxService = new InboxService(database, context)
    const project = projects.create({ name: '桌面端', description: '桌面产品', color: '#2563eb' })
    const inbox = inboxService.create({
      content: '修复登录页在离线时重复请求的问题',
      tag_names: ['#缺陷'],
      ai_suggestion: {
        target: 'work_log',
        title: '离线登录优化',
        summary: 'AI 仅提供归类建议',
        project_id: project.public_id,
        tag_names: ['#缺陷', '#技术/前端'],
        include_in_reports: true
      }
    })

    expect(database.prepare('SELECT COUNT(*) AS count FROM work_logs').get()).toEqual({ count: 0 })

    const confirmed = inboxService.confirm(inbox.public_id)

    expect(confirmed.target).toBe('work_log')
    expect(database.prepare('SELECT content, project_id FROM work_logs').all()).toEqual([
      { content: '修复登录页在离线时重复请求的问题', project_id: expect.any(Number) }
    ])
    expect(database.prepare('SELECT COUNT(*) AS count FROM work_logs').get()).toEqual({ count: 1 })
    expect(database.prepare('SELECT state, ai_suggestion FROM inbox_items WHERE public_id = ?').get(inbox.public_id))
      .toEqual({ state: 'confirmed', ai_suggestion: expect.stringContaining('离线登录优化') })
    expect(database.prepare('SELECT path FROM tags ORDER BY path').all()).toEqual([
      { path: '技术/前端' },
      { path: '缺陷' }
    ])
    expect(database.prepare("SELECT entity_type, operation_type FROM sync_operations ORDER BY id").all())
      .toEqual(expect.arrayContaining([
        { entity_type: 'inbox_item', operation_type: 'create' },
        { entity_type: 'work_log', operation_type: 'create' },
        { entity_type: 'inbox_item', operation_type: 'update' },
        { entity_type: 'tag_assignment', operation_type: 'update' }
      ]))
    const assignment = database.prepare(`
      SELECT entity_public_id, payload
      FROM sync_operations
      WHERE entity_type = 'tag_assignment' AND entity_public_id LIKE ?
      ORDER BY id
      LIMIT 1
    `).get(`${inbox.public_id}:tag:%`) as { entity_public_id: string; payload: string }
    const payload = JSON.parse(assignment.payload) as { data: Record<string, string>; action: string }
    expect(assignment.entity_public_id).toBe(`${inbox.public_id}:tag:${payload.data.tag_public_id}`)
    expect(payload).toMatchObject({
      action: 'update',
      data: {
        record_type: 'inbox_item',
        record_public_id: inbox.public_id,
        action: 'attach'
      }
    })
    database.close()
  })

  it('没有 AI 建议时允许人工转为任务并保留收件箱内容', () => {
    const { database, context } = createDatabase()
    const inboxService = new InboxService(database, context)
    const inbox = inboxService.create({ content: '人工整理成一个待办任务' })

    const confirmed = inboxService.confirm(inbox.public_id, {
      target: 'task',
      project_id: null,
      tag_names: []
    })

    expect(confirmed.target).toBe('task')
    expect(database.prepare('SELECT title, description, status FROM tasks').get()).toEqual({
      title: '人工整理成一个待办任务',
      description: '人工整理成一个待办任务',
      status: 'todo'
    })
    expect(database.prepare('SELECT state FROM inbox_items WHERE public_id = ?').get(inbox.public_id))
      .toEqual({ state: 'confirmed' })
    database.close()
  })

  it('标签关联失败时回滚目标实体、收件箱状态和新增 outbox 操作', () => {
    const { database, context } = createDatabase()
    const inboxService = new InboxService(database, context)
    const inbox = inboxService.create({
      content: '必须完整回滚',
      ai_suggestion: {
        target: 'work_log',
        title: '回滚验证',
        summary: '',
        project_id: null,
        tag_names: ['#技术/后端'],
        include_in_reports: true
      }
    })
    const before = database.prepare('SELECT COUNT(*) AS count FROM sync_operations').get()
    database.exec(`
      CREATE TRIGGER fail_work_log_tag_link
      BEFORE INSERT ON work_log_tags
      BEGIN
        SELECT RAISE(ABORT, 'tag link failed');
      END;
    `)

    expect(() => inboxService.confirm(inbox.public_id)).toThrow('tag link failed')

    expect(database.prepare('SELECT COUNT(*) AS count FROM work_logs').get()).toEqual({ count: 0 })
    expect(database.prepare('SELECT state FROM inbox_items WHERE public_id = ?').get(inbox.public_id))
      .toEqual({ state: 'unorganized' })
    expect(database.prepare('SELECT COUNT(*) AS count FROM sync_operations').get()).toEqual(before)
    expect(database.prepare('SELECT COUNT(*) AS count FROM tags').get()).toEqual({ count: 0 })
    expect(database.prepare('SELECT COUNT(*) AS count FROM inbox_tags').get()).toEqual({ count: 0 })
    expect(database.prepare('SELECT COUNT(*) AS count FROM content_search').get()).toEqual({ count: 1 })
    expect(database.prepare("SELECT COUNT(*) AS count FROM sync_operations WHERE entity_type = 'tag_assignment'").get())
      .toEqual({ count: 0 })
    database.close()
  })

  it('创建收件箱标签关联失败时不留下标签、关联、索引或关联 outbox', () => {
    const { database, context } = createDatabase()
    const inboxService = new InboxService(database, context)
    database.exec(`
      CREATE TRIGGER fail_inbox_tag_link
      BEFORE INSERT ON inbox_tags
      BEGIN
        SELECT RAISE(ABORT, 'inbox tag link failed');
      END;
    `)

    expect(() => inboxService.create({ content: '创建失败', tag_names: ['#失败/标签'] }))
      .toThrow('inbox tag link failed')

    expect(database.prepare('SELECT COUNT(*) AS count FROM tags').get()).toEqual({ count: 0 })
    expect(database.prepare('SELECT COUNT(*) AS count FROM inbox_items').get()).toEqual({ count: 0 })
    expect(database.prepare('SELECT COUNT(*) AS count FROM inbox_tags').get()).toEqual({ count: 0 })
    expect(database.prepare('SELECT COUNT(*) AS count FROM content_search').get()).toEqual({ count: 0 })
    expect(database.prepare("SELECT COUNT(*) AS count FROM sync_operations WHERE entity_type = 'tag_assignment'").get())
      .toEqual({ count: 0 })
    database.close()
  })

  it('软删除项目默认不返回，但历史读取仍保留该项目', () => {
    const { database, context } = createDatabase()
    const projects = new ProjectService(database, context)
    const project = projects.create({ name: '归档项目', description: '', color: '#f97316' })

    projects.softDelete(project.public_id)

    expect(projects.list().items).toEqual([])
    expect(projects.get(project.public_id)).toBeNull()
    expect(projects.get(project.public_id, { includeDeleted: true })).toMatchObject({
      public_id: project.public_id,
      archived_at: expect.stringMatching(/Z$/)
    })
    database.close()
  })

  it('通过服务软删除收件箱，并写入删除同步操作', () => {
    const { database, context } = createDatabase()
    const inboxService = new InboxService(database, context)
    const inbox = inboxService.create({ content: '待删除的收件箱记录' })

    const deleted = inboxService.softDelete(inbox.public_id)

    expect(deleted).toMatchObject({ public_id: inbox.public_id, content: inbox.content })
    expect(inboxService.get(inbox.public_id)).toBeNull()
    expect(inboxService.list().items).toEqual([])
    expect(database.prepare('SELECT deleted_at FROM inbox_items WHERE public_id = ?').get(inbox.public_id))
      .toEqual({ deleted_at: expect.stringMatching(/Z$/) })
    expect(database.prepare(`
      SELECT entity_type, entity_public_id, operation_type
      FROM sync_operations
      WHERE entity_type = 'inbox_item' AND entity_public_id = ?
      ORDER BY id DESC LIMIT 1
    `).get(inbox.public_id)).toEqual({
      entity_type: 'inbox_item',
      entity_public_id: inbox.public_id,
      operation_type: 'delete'
    })
    database.close()
  })

  it('规范化多标签并按父标签搜索其全部层级，同时隔离其他工作区', () => {
    const { database, context } = createDatabase()
    const inboxService = new InboxService(database, context)
    const searchService = new SearchService(database, context)
    const first = inboxService.create({ content: '前端问题', tag_names: [' #技术 /  前端 ', '#缺陷'] })
    const second = inboxService.create({ content: '后端问题', tag_names: ['#技术/后端'] })
    inboxService.create({ content: '产品讨论', tag_names: ['#产品'] })

    const otherWorkspace = database.prepare(`
      INSERT INTO workspaces (public_id, name, created_at, updated_at)
      VALUES ('other-workspace', '其他空间', '2026-08-23T00:00:00.000Z', '2026-08-23T00:00:00.000Z')
    `).run()
    const otherWorkspaceId = Number(otherWorkspace.lastInsertRowid)
    const otherUser = database.prepare(`
      INSERT INTO users (public_id, workspace_id, name, created_at, updated_at)
      VALUES ('other-user', ?, '其他用户', '2026-08-23T00:00:00.000Z', '2026-08-23T00:00:00.000Z')
    `).run(otherWorkspaceId)
    const otherInbox = new InboxService(database, {
      workspace_id: otherWorkspaceId,
      user_id: Number(otherUser.lastInsertRowid)
    })
    otherInbox.create({ content: '不应被当前空间检索', tag_names: ['#技术/移动端'] })

    expect(searchService.searchInbox({ tag_names: ['#技术'] }).items.map((item) => item.public_id))
      .toEqual([second.public_id, first.public_id])
    expect(searchService.searchInbox({ tag_names: ['#技术', '#缺陷'] }).items.map((item) => item.public_id))
      .toEqual([first.public_id])
    expect(searchService.searchInbox({ text: '前端' }).items.map((item) => item.public_id))
      .toEqual([first.public_id])
    expect(database.prepare('SELECT path FROM tags WHERE workspace_id = ? ORDER BY path').all(context.workspace_id))
      .toEqual(expect.arrayContaining([
        { path: '技术/前端' },
        { path: '技术/后端' },
        { path: '产品' },
        { path: '缺陷' }
      ]))
    database.close()
  })

  it('以路径前缀作为唯一层级模型，不从偶然存在的父标签返回 parent_id', () => {
    const { database, context } = createDatabase()
    const tags = new LocalTagRepository(database)
    tags.create(context, '#层级')
    const child = tags.create(context, '#层级/子标签')

    expect(child.parent_id).toBeNull()
    expect(tags.get(context, child.public_id)?.parent_id).toBeNull()
    database.close()
  })

  it('三个本地 Repository 支持分页、total、软删除和工作区隔离', () => {
    const { database, context } = createDatabase()
    const projects = new ProjectService(database, context)
    const projectRepository = new LocalProjectRepository(database)
    const inboxService = new InboxService(database, context)
    const inboxRepository = new LocalInboxRepository(database)
    const tagRepository = new LocalTagRepository(database)

    const projectIds = [
      projects.create({ name: '项目一', description: '', color: '#111111' }).public_id,
      projects.create({ name: '项目二', description: '', color: '#222222' }).public_id,
      projects.create({ name: '项目三', description: '', color: '#333333' }).public_id
    ]
    const inboxIds = [
      inboxService.create({ content: '收件箱一' }).public_id,
      inboxService.create({ content: '收件箱二' }).public_id,
      inboxService.create({ content: '收件箱三' }).public_id
    ]
    inboxRepository.update(context, inboxIds[1], { state: 'confirmed' })
    const tagIds = [
      tagRepository.create(context, '#标签一').public_id,
      tagRepository.create(context, '#标签二').public_id,
      tagRepository.create(context, '#标签三').public_id
    ]

    expect(projectRepository.list(context, { limit: 2, offset: 1 })).toMatchObject({ total: 3, items: expect.any(Array) })
    expect(projectRepository.list(context, { limit: 2, offset: 1 }).items).toHaveLength(2)
    expect(inboxRepository.list(context, { limit: 2, offset: 1 })).toMatchObject({ total: 3 })
    expect(inboxRepository.list(context, { limit: 2, offset: 1 }).items).toHaveLength(2)
    expect(inboxRepository.list(context, { state: 'unorganized' }).total).toBe(2)
    expect(inboxRepository.list(context, { state: 'confirmed' }).items.map((item) => item.public_id)).toEqual([inboxIds[1]])
    expect(tagRepository.list(context, { limit: 2, offset: 1 })).toMatchObject({ total: 3 })
    expect(tagRepository.list(context, { limit: 2, offset: 1 }).items).toHaveLength(2)

    projectRepository.softDelete(context, projectIds[0])
    inboxRepository.softDelete(context, inboxIds[0])
    tagRepository.softDelete(context, tagIds[0])
    expect(projectRepository.list(context).total).toBe(2)
    expect(inboxRepository.list(context).total).toBe(2)
    expect(tagRepository.list(context).total).toBe(2)

    const otherWorkspace = database.prepare(`
      INSERT INTO workspaces (public_id, name, created_at, updated_at)
      VALUES ('paging-other-workspace', '分页其他空间', '2026-08-23T00:00:00.000Z', '2026-08-23T00:00:00.000Z')
    `).run()
    const otherWorkspaceId = Number(otherWorkspace.lastInsertRowid)
    const otherUser = database.prepare(`
      INSERT INTO users (public_id, workspace_id, name, created_at, updated_at)
      VALUES ('paging-other-user', ?, '分页其他用户', '2026-08-23T00:00:00.000Z', '2026-08-23T00:00:00.000Z')
    `).run(otherWorkspaceId)
    const otherContext = {
      workspace_id: otherWorkspaceId,
      user_id: Number(otherUser.lastInsertRowid)
    }
    const otherProjectRepository = new LocalProjectRepository(database)
    const otherInboxService = new InboxService(database, otherContext)
    const otherInboxRepository = new LocalInboxRepository(database)
    const otherTagRepository = new LocalTagRepository(database)
    otherProjectRepository.create(otherContext, { name: '其他项目', description: '', color: '#444444' })
    otherInboxService.create({ content: '其他收件箱' })
    otherTagRepository.create(otherContext, '#其他标签')

    expect(projectRepository.list(context).total).toBe(2)
    expect(inboxRepository.list(context).total).toBe(2)
    expect(tagRepository.list(context).total).toBe(2)
    expect(otherInboxRepository.list(otherContext).total).toBe(1)
    database.close()
  })
})

import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { openDatabase, runMigrations } from '../../src/main/database/connection'
import type { WorkspaceContext } from '../../src/main/repositories/contracts'
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
      ai_suggestion: {
        target: 'work_log',
        title: '离线登录优化',
        summary: 'AI 仅提供归类建议',
        project_id: project.public_id,
        repository_id: null,
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
        { entity_type: 'inbox_item', operation_type: 'update' }
      ]))
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
        repository_id: null,
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
})

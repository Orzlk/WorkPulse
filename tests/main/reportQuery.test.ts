import { randomUUID } from 'node:crypto'

import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

import { runMigrations } from '../../src/main/database/migrations'
import { resolveReportPeriod } from '../../src/main/lib/period'
import { generatePeriodReportContent, type PeriodReportProvider } from '../../src/main/reports/periodReportAi'
import { ReportQueryService } from '../../src/main/reports/reportQueryService'
import { ReportService } from '../../src/main/reports/reportService'
import type { ReportRequest } from '../../src/main/reports/reportTypes'

interface SeedIds {
  alpha: number
  beta: number
  alphaPublicId: string
  betaPublicId: string
  alphaRepository: number
  alphaRepositoryPublicId: string
}

function context(database: Database.Database): { workspace_id: number; user_id: number } {
  return database.prepare('SELECT workspace_id, id AS user_id FROM users ORDER BY id LIMIT 1').get() as {
    workspace_id: number
    user_id: number
  }
}

function createDatabase(): Database.Database {
  const database = new Database(':memory:')
  runMigrations(database)
  return database
}

function seed(database: Database.Database): SeedIds {
  const { workspace_id, user_id } = context(database)
  const now = '2026-08-24T00:00:00.000Z'
  const alphaPublicId = randomUUID()
  const betaPublicId = randomUUID()
  const alpha = Number(database.prepare(`
    INSERT INTO projects (public_id, workspace_id, name, description, color, created_by, updated_by, created_at, updated_at)
    VALUES (?, ?, 'Alpha', '', '#111111', ?, ?, ?, ?)
  `).run(alphaPublicId, workspace_id, user_id, user_id, now, now).lastInsertRowid)
  const beta = Number(database.prepare(`
    INSERT INTO projects (public_id, workspace_id, name, description, color, created_by, updated_by, created_at, updated_at)
    VALUES (?, ?, 'Beta', '', '#222222', ?, ?, ?, ?)
  `).run(betaPublicId, workspace_id, user_id, user_id, now, now).lastInsertRowid)
  const alphaRepositoryPublicId = randomUUID()
  const alphaRepository = Number(database.prepare(`
    INSERT INTO repositories (public_id, workspace_id, project_id, name, enabled, created_by, updated_by, created_at, updated_at)
    VALUES (?, ?, ?, 'alpha-repo', 1, ?, ?, ?, ?)
  `).run(alphaRepositoryPublicId, workspace_id, alpha, user_id, user_id, now, now).lastInsertRowid)
  return { alpha, beta, alphaPublicId, betaPublicId, alphaRepository, alphaRepositoryPublicId }
}

function request(overrides: Partial<ReportRequest> = {}): ReportRequest {
  return {
    type: 'weekly',
    anchorDate: '2026-08-23',
    timeZone: 'Asia/Shanghai',
    projectIds: [],
    repositoryIds: [],
    ...overrides
  }
}

describe('ReportQueryService', () => {
  it('uses UTC half-open natural-week boundaries and excludes unorganized inbox items', () => {
    const database = createDatabase()
    const ids = seed(database)
    const { workspace_id, user_id } = context(database)
    const insertLog = database.prepare(`
      INSERT INTO work_logs (public_id, workspace_id, project_id, content, category, created_by, updated_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, '', ?, ?, ?, ?)
    `)
    insertLog.run(randomUUID(), workspace_id, ids.alpha, '周期开始', user_id, user_id, '2026-08-16T16:00:00.000Z', '2026-08-16T16:00:00.000Z')
    insertLog.run(randomUUID(), workspace_id, ids.alpha, '周期最后一秒', user_id, user_id, '2026-08-23T15:59:59.999Z', '2026-08-23T15:59:59.999Z')
    insertLog.run(randomUUID(), workspace_id, ids.alpha, '下周期开始', user_id, user_id, '2026-08-23T16:00:00.000Z', '2026-08-23T16:00:00.000Z')
    database.prepare(`
      INSERT INTO inbox_items (public_id, workspace_id, project_id, content, status, state, include_in_reports, created_by, updated_by, created_at, updated_at)
      VALUES (?, ?, ?, '草稿收件箱', 'inbox', 'unorganized', 1, ?, ?, '2026-08-18T00:00:00.000Z', '2026-08-18T00:00:00.000Z')
    `).run(randomUUID(), workspace_id, ids.alpha, user_id, user_id)
    database.prepare(`
      INSERT INTO inbox_items (public_id, workspace_id, project_id, content, status, state, include_in_reports, created_by, updated_by, created_at, updated_at)
      VALUES (?, ?, ?, '已确认收件箱', 'organized', 'confirmed', 1, ?, ?, '2026-08-18T00:00:00.000Z', '2026-08-18T00:00:00.000Z')
    `).run(randomUUID(), workspace_id, ids.alpha, user_id, user_id)

    const snapshot = new ReportQueryService(database, context(database)).buildSnapshot(request())
    const alpha = snapshot.projects.find((project) => project.public_id === ids.alphaPublicId)

    expect(alpha?.work_logs.map((log) => log.content)).toEqual(['周期开始', '周期最后一秒'])
    expect(alpha?.inbox_items.map((item) => item.content)).toEqual(['已确认收件箱'])
    database.close()
  })

  it('groups tasks by their current project when created or completed during the period and applies project and repository filters', () => {
    const database = createDatabase()
    const ids = seed(database)
    const { workspace_id, user_id } = context(database)
    const insertTask = database.prepare(`
      INSERT INTO tasks (public_id, workspace_id, project_id, title, description, status, board_column, position, created_by, updated_by, created_at, updated_at, completed_at)
      VALUES (?, ?, ?, ?, '', ?, ?, 0, ?, ?, ?, ?, ?)
    `)
    insertTask.run(randomUUID(), workspace_id, ids.alpha, '期间创建', 'todo', 'todo', user_id, user_id, '2026-08-18T00:00:00.000Z', '2026-08-18T00:00:00.000Z', null)
    insertTask.run(randomUUID(), workspace_id, ids.beta, '期间完成', 'done', 'done', user_id, user_id, '2026-08-01T00:00:00.000Z', '2026-08-19T00:00:00.000Z', '2026-08-19T00:00:00.000Z')
    database.prepare(`
      INSERT INTO git_commits (public_id, workspace_id, repository_id, commit_hash, author_name, author_email, committed_at, message, branch, files_changed, additions, deletions, created_by, updated_by, created_at, updated_at)
      VALUES (?, ?, ?, 'abc123', '开发者', 'dev@example.com', '2026-08-20T00:00:00.000Z', '实现核心功能', 'main', 2, 8, 1, ?, ?, '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z')
    `).run(randomUUID(), workspace_id, ids.alphaRepository, user_id, user_id)

    const query = new ReportQueryService(database, context(database))
    const allSnapshot = query.buildSnapshot(request())
    expect(allSnapshot.projects.find((project) => project.public_id === ids.alphaPublicId)?.tasks.map((task) => task.title)).toEqual(['期间创建'])
    expect(allSnapshot.projects.find((project) => project.public_id === ids.betaPublicId)?.tasks.map((task) => task.title)).toEqual(['期间完成'])
    expect(allSnapshot.projects.find((project) => project.public_id === ids.alphaPublicId)?.git_commits).toEqual([
      expect.objectContaining({ subject: '实现核心功能', repository_id: ids.alphaRepositoryPublicId })
    ])

    const filtered = query.buildSnapshot(request({ projectIds: [ids.alphaPublicId], repositoryIds: [ids.alphaRepositoryPublicId] }))
    expect(filtered.projects.map((project) => project.public_id)).toEqual([ids.alphaPublicId])
    expect(filtered.projects[0].git_commits).toHaveLength(1)
    database.close()
  })

  it('uses an unassigned group and only serializes the snapshot field whitelist', () => {
    const database = createDatabase()
    const { workspace_id, user_id } = context(database)
    database.prepare(`
      INSERT INTO work_logs (public_id, workspace_id, content, category, created_by, updated_by, created_at, updated_at)
      VALUES (?, ?, '未归属日志', '内部分类', ?, ?, '2026-08-18T00:00:00.000Z', '2026-08-18T00:00:00.000Z')
    `).run(randomUUID(), workspace_id, user_id, user_id)

    const snapshot = new ReportQueryService(database, context(database)).buildSnapshot(request())
    const unassigned = snapshot.projects.find((project) => project.public_id === null)
    const serialized = JSON.stringify(snapshot)

    expect(unassigned?.name).toBe('未归属项目')
    expect(serialized).not.toContain('内部分类')
    expect(serialized).not.toContain('local_path')
    database.close()
  })
})

describe('ReportService and period AI generation', () => {
  it('creates incrementing report versions without overwriting source snapshots', async () => {
    const database = createDatabase()
    const service = new ReportService(database, context(database), {
      generateContent: async () => '# 周报\n\n核心功能：完成查询服务。'
    })

    const first = await service.generate(request())
    const second = await service.generate(request())
    const rows = database.prepare('SELECT version, status, source_snapshot, content FROM reports ORDER BY version').all() as Array<{
      version: number
      status: string
      source_snapshot: string
      content: string
    }>

    expect([first.version, second.version]).toEqual([1, 2])
    expect(rows).toEqual([
      expect.objectContaining({ version: 1, status: 'ready', content: expect.stringContaining('核心功能') }),
      expect.objectContaining({ version: 2, status: 'ready', content: expect.stringContaining('核心功能') })
    ])
    expect(JSON.parse(rows[0].source_snapshot)).toEqual(expect.objectContaining({ schema_version: 1 }))
    const edited = service.updateContent(second.public_id, '# 周报\n\n人工补充说明。')
    expect(edited?.content).toContain('人工补充')
    expect(database.prepare('SELECT content FROM reports WHERE version = 1').get()).toEqual({
      content: '# 周报\n\n核心功能：完成查询服务。'
    })
    database.close()
  })

  it('stores an AI failure as a retryable error report instead of ready content', async () => {
    const database = createDatabase()
    const service = new ReportService(database, context(database), {
      generateContent: async () => {
        throw new Error('provider unavailable')
      }
    })

    await expect(service.generate(request())).rejects.toThrow('provider unavailable')
    expect(database.prepare('SELECT status, error_message, retry_count, content FROM reports').get()).toEqual({
      status: 'error',
      error_message: 'provider unavailable',
      retry_count: 1,
      content: ''
    })
    database.close()
  })

  it('reads an old report as an explicitly unavailable legacy snapshot', () => {
    const database = createDatabase()
    const { workspace_id, user_id } = context(database)
    const now = '2026-08-23T00:00:00.000Z'
    const publicId = randomUUID()
    database.prepare(`
      INSERT INTO reports (
        public_id, workspace_id, type, period_type, date_from, date_to, period_start, period_end_exclusive,
        time_zone, timezone, project_scope, repository_scope, source_snapshot, content, version, status,
        created_by, updated_by, created_at, updated_at
      ) VALUES (?, ?, 'monthly', 'monthly', '2026-08-01', '2026-08-31', ?, ?, 'Asia/Shanghai', 'Asia/Shanghai', '[]', '[]', '{}', '旧报告', 1, 'ready', ?, ?, ?, ?)
    `).run(publicId, workspace_id, '2026-08-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', user_id, user_id, now, now)

    const report = new ReportService(database, context(database)).get(publicId)
    expect(report?.source_snapshot).toMatchObject({
      schema_version: 'legacy',
      unavailable: true,
      projects: [],
      report_public_id: publicId,
      report_type: 'monthly'
    })
    database.close()
  })

  it('validates period AI provider responses and returns a displayable empty report without calling the provider', async () => {
    const period = resolveReportPeriod('monthly', '2026-08-23', 'Asia/Shanghai')
    const provider: PeriodReportProvider = async () => ({ content: '## 月报\n\n下月建议：继续验证。' })
    const content = await generatePeriodReportContent({ schema_version: 1, projects: [] }, 'monthly', period, { provider })

    expect(content).toContain('暂无可汇总的工作记录')
    await expect(generatePeriodReportContent({ schema_version: 1, projects: [{ name: 'Alpha' }] }, 'weekly', period, {
      provider: async () => ({ content: '   ' })
    })).rejects.toThrow('AI response content is empty')
    await expect(generatePeriodReportContent({ schema_version: 1, projects: [{ name: 'Alpha' }] }, 'weekly', period, {
      timeoutMs: 5,
      provider: ({ signal }) => new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')))
      })
    })).rejects.toThrow('AI request timed out')
  })
})

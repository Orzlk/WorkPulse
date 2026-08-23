import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'

import { backupDatabase, getDatabaseVersion, openDatabase, runMigrations } from '../../src/main/database/connection'
import { createDatabaseExport, mergeDatabaseImport } from '../../src/main/database/transfer'
import type { WorkspaceContext } from '../../src/main/repositories/contracts'
import { InboxService } from '../../src/main/services/inboxService'
import { ProjectService } from '../../src/main/services/projectService'
import { RepositoryService } from '../../src/main/services/repositoryService'
import { ReportService } from '../../src/main/reports/reportService'

const temporaryDirectories: string[] = []

function createTemporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  temporaryDirectories.push(directory)
  return directory
}

function getContext(database: Database.Database): WorkspaceContext {
  return database.prepare(`
    SELECT workspaces.id AS workspace_id, users.id AS user_id
    FROM workspaces
    INNER JOIN users ON users.workspace_id = workspaces.id
    WHERE workspaces.deleted_at IS NULL AND users.deleted_at IS NULL
    ORDER BY workspaces.id, users.id
    LIMIT 1
  `).get() as WorkspaceContext
}

function runGit(directory: string, args: string[], environment: NodeJS.ProcessEnv = process.env): void {
  execFileSync('git', args, { cwd: directory, env: environment, stdio: 'pipe' })
}

function createTemporaryGitRepository(): string {
  const directory = createTemporaryDirectory('workpulse-stage1-git-')
  runGit(directory, ['init'])
  runGit(directory, ['config', 'user.name', '验收用户'])
  runGit(directory, ['config', 'user.email', 'acceptance@example.com'])
  writeFileSync(join(directory, 'acceptance.txt'), '阶段一验收\n')
  runGit(directory, ['add', 'acceptance.txt'])
  const timestamp = '2026-08-20T08:00:00.000Z'
  runGit(directory, ['commit', '-m', '阶段一验收提交'], {
    ...process.env,
    GIT_AUTHOR_DATE: timestamp,
    GIT_COMMITTER_DATE: timestamp
  })
  return directory
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('stage 1 acceptance', () => {
  it('runs the local-first workflow on disposable database and Git data only', async () => {
    const directory = createTemporaryDirectory('workpulse-stage1-db-')
    const databasePath = join(directory, 'workpulse.db')
    const backupPath = join(directory, 'backup.db')
    const database = openDatabase(databasePath)
    runMigrations(database)
    const context = getContext(database)
    const gitDirectory = createTemporaryGitRepository()

    expect(getDatabaseVersion(database)).toBe(11)

    const projects = new ProjectService(database, context)
    const project = projects.create({ name: '阶段一项目', description: '临时验收数据', color: '#64748b' })
    const repositories = new RepositoryService(database, context)
    const repository = repositories.create({
      name: '阶段一临时仓库',
      local_path: gitDirectory,
      project_id: project.public_id
    })
    const firstScan = await repositories.scanOne(repository.public_id, '2026-08-24T00:00:00.000Z')
    const repeatedScan = await repositories.scanOne(repository.public_id, '2026-08-24T00:00:00.000Z')
    expect(firstScan).toMatchObject({ status: 'succeeded', inserted_count: 1 })
    expect(repeatedScan).toMatchObject({ status: 'succeeded', inserted_count: 0 })

    const inbox = new InboxService(database, context)
    const unorganized = inbox.create({
      content: '不可发送给 AI 的临时草稿',
      project_id: project.public_id,
      include_in_reports: true
    })
    const organized = inbox.create({
      content: '已完成阶段一验收',
      project_id: project.public_id,
      repository_id: repository.public_id,
      tag_names: ['验收/阶段一'],
      ai_suggestion: {
        target: 'work_log',
        title: '阶段一验收',
        summary: '记录验收结果',
        project_id: project.public_id,
        repository_id: repository.public_id,
        tag_names: ['验收/阶段一'],
        include_in_reports: true
      }
    })
    expect(inbox.confirm(organized.public_id).target).toBe('work_log')
    expect(inbox.ignore(unorganized.public_id)?.state).toBe('ignored')

    const reports = new ReportService(database, context, {
      generateContent: async (snapshot) => {
        expect(JSON.stringify(snapshot)).not.toContain('不可发送给 AI 的临时草稿')
        return '# 周报\n\n核心功能：阶段一验收通过。'
      }
    })
    const report = await reports.generate({
      type: 'weekly',
      anchorDate: '2026-08-23',
      timeZone: 'Asia/Shanghai',
      projectIds: [project.public_id],
      repositoryIds: [repository.public_id]
    })
    expect(report).toMatchObject({
      type: 'weekly',
      display_start: '2026-08-17',
      display_end_inclusive: '2026-08-23',
      status: 'ready'
    })

    await backupDatabase(database, backupPath)
    const backup = new Database(backupPath, { readonly: true })
    expect(backup.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }])
    expect(backup.prepare('SELECT COUNT(*) AS count FROM reports').get()).toEqual({ count: 1 })
    backup.close()

    const exported = createDatabaseExport(database, context)
    const serialized = JSON.stringify(exported)
    expect(serialized).not.toContain(gitDirectory)
    expect(serialized).not.toContain('api_key')

    const targetDirectory = createTemporaryDirectory('workpulse-stage1-import-')
    const target = openDatabase(join(targetDirectory, 'workpulse.db'))
    runMigrations(target)
    const imported = mergeDatabaseImport(target, getContext(target), exported)
    expect(imported.inserted).toBeGreaterThan(0)
    expect(target.prepare('SELECT COUNT(*) AS count FROM reports').get()).toEqual({ count: 1 })
    expect(target.prepare('SELECT is_valid FROM repository_bindings').get()).toEqual({ is_valid: 0 })
    target.close()
    database.close()
  })
})

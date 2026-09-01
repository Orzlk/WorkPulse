import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { openDatabase, runMigrations } from '../../src/main/database/connection'
import type { WorkspaceContext } from '../../src/main/repositories/contracts'
import { GitCommand, GitReadError } from '../../src/main/git/gitCommand'
import { GitScanner } from '../../src/main/git/gitScanner'
import { ProjectService } from '../../src/main/services/projectService'
import { RepositoryScheduler, RepositoryService } from '../../src/main/services/repositoryService'

const temporaryDirectories: string[] = []

function createTemporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  temporaryDirectories.push(directory)
  return directory
}

function runGit(directory: string, args: string[], env: NodeJS.ProcessEnv = process.env): void {
  execFileSync('git', args, { cwd: directory, env, stdio: 'pipe' })
}

function commit(directory: string, fileName: string, content: string | Buffer, message: string, date: Date): void {
  writeFileSync(join(directory, fileName), content)
  runGit(directory, ['add', fileName])
  const timestamp = date.toISOString()
  runGit(directory, ['commit', '-m', message], {
    ...process.env,
    GIT_AUTHOR_DATE: timestamp,
    GIT_COMMITTER_DATE: timestamp
  })
}

function createGitRepository(): string {
  const directory = createTemporaryDirectory('workpulse-git-')
  runGit(directory, ['init'])
  runGit(directory, ['config', 'user.name', '测试用户'])
  runGit(directory, ['config', 'user.email', 'test@example.com'])
  const now = Date.now()
  commit(directory, 'old.txt', 'old', '超过三十天的提交', new Date(now - 40 * 24 * 60 * 60 * 1000))
  commit(directory, 'recent.txt', '一\n二\n三\n', '最近文本提交', new Date(now - 10 * 24 * 60 * 60 * 1000))
  commit(directory, 'image.bin', Buffer.from([0, 1, 2, 3]), '最近二进制提交', new Date(now - 2 * 24 * 60 * 60 * 1000))
  return directory
}

function createDatabase(): { database: Database.Database; context: WorkspaceContext } {
  const directory = createTemporaryDirectory('workpulse-git-db-')
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
      // Windows 上 SQLite 或 Git 进程可能在断言失败后短暂占用临时目录。
    }
  }
})

describe('GitScanner', () => {
  it('GitCommand 拒绝危险参数但保留实际只读命令', async () => {
    const directory = createGitRepository()
    const command = new GitCommand()

    for (const args of [
      ['log', '--output=unsafe.txt'],
      ['log', '--exec=echo unsafe'],
      ['log', '--ext-diff'],
      ['log', '--textconv'],
      ['log', '-c', 'core.pager=cat'],
      ['log', '--config=core.pager=cat']
    ]) {
      await expect(command.execute(directory, args)).rejects.toThrow('只读')
    }

    await expect(command.execute(directory, ['rev-parse', '--show-toplevel']))
      .resolves.toContain(directory.replaceAll('\\', '/'))
  })

  it('仅发起允许的只读 Git 命令', async () => {
    const calls: string[][] = []
    const scanner = new GitScanner({
      execute: async (_cwd, args) => {
        calls.push(args)
        if (args[0] === 'log') return '\u001e0123456789012345678901234567890123456789\u001f作者\u001fauthor@example.com\u001f2026-08-23T00:00:00.000Z\u001f提交主题\n1\t0\tfile.txt\n'
        return args.includes('--show-toplevel') ? 'D:/repo\n' : 'main\n'
      }
    })

    const result = await scanner.scan(
      { id: 1, public_id: 'repository-1' },
      { id: 1, repository_id: 1, local_path: 'D:/repo' }
    )

    expect(calls.map((args) => args[0])).toEqual(['rev-parse', 'rev-parse', 'log'])
    expect(result.commits).toMatchObject([{ additions: 1, deletions: 0, file_count: 1 }])
  })

  it('按 UTC 半开区间过滤恰好落在上下界的提交', async () => {
    const since = '2026-08-23T00:00:00.000Z'
    const until = '2026-08-23T02:00:00.000Z'
    const hash = (value: string) => value.repeat(40).slice(0, 40)
    const output = [
      `${hash('a')}\u001f作者\u001fa@example.com\u001f${since}\u001f下界\n1\t0\ta.txt`,
      `${hash('b')}\u001f作者\u001fb@example.com\u001f2026-08-23T01:00:00.000Z\u001f区间内\n1\t0\tb.txt`,
      `${hash('c')}\u001f作者\u001fc@example.com\u001f${until}\u001f上界\n1\t0\tc.txt`
    ].map((record) => `\u001e${record}`).join('\n')
    const scanner = new GitScanner({
      execute: async (_cwd, args) => {
        if (args[0] === 'log') return output
        return args.includes('--show-toplevel') ? 'D:/repo\n' : 'main\n'
      }
    })

    const result = await scanner.scan(
      { id: 1, public_id: 'repository-1' },
      { id: 1, repository_id: 1, local_path: 'D:/repo' },
      { since, until }
    )

    expect(result.commits.map((commit) => commit.subject)).toEqual(['下界', '区间内'])
  })

  it('遇到非法时间或异常提交格式时失败而不是静默丢弃', async () => {
    const invalidTimestampScanner = new GitScanner({
      execute: async (_cwd, args) => {
        if (args[0] === 'log') return '\u001e0123456789012345678901234567890123456789\u001f作者\u001fa@example.com\u001fnot-a-time\u001f非法时间\n'
        return args.includes('--show-toplevel') ? 'D:/repo\n' : 'main\n'
      }
    })
    const malformedScanner = new GitScanner({
      execute: async (_cwd, args) => {
        if (args[0] === 'log') return '\u001e0123456789012345678901234567890123456789\u001f异常\u001f字段\u001f2026-08-23T00:00:00.000Z\u001f主题\u001f多余字段\n'
        return args.includes('--show-toplevel') ? 'D:/repo\n' : 'main\n'
      }
    })
    const repository = { id: 1, public_id: 'repository-1' }
    const binding = { id: 1, repository_id: 1, local_path: 'D:/repo' }

    await expect(invalidTimestampScanner.scan(repository, binding)).rejects.toThrow('提交时间')
    await expect(malformedScanner.scan(repository, binding)).rejects.toThrow('提交格式')
  })

  it('严格校验 numstat 数字字段，拒绝部分数字和空格', async () => {
    for (const additions of ['12oops', ' 12', '12 ']) {
      const scanner = new GitScanner({
        execute: async (_cwd, args) => {
          if (args[0] === 'log') {
            return `\u001e0123456789012345678901234567890123456789\u001f作者\u001fa@example.com\u001f2026-08-23T00:00:00.000Z\u001f异常统计\n${additions}\t0\tfile.txt\n`
          }
          return args.includes('--show-toplevel') ? 'D:/repo\n' : 'main\n'
        }
      })

      await expect(scanner.scan(
        { id: 1, public_id: 'repository-1' },
        { id: 1, repository_id: 1, local_path: 'D:/repo' }
      )).rejects.toThrow('提交统计格式')
    }
  })

  it('只读取最近三十天提交，并统计文本和二进制变更', async () => {
    const directory = createGitRepository()
    const scanner = new GitScanner()

    const result = await scanner.scan(
      { id: 1, public_id: 'repository-1' },
      { id: 1, repository_id: 1, local_path: directory },
      { since: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString() }
    )

    expect(result.commits).toHaveLength(2)
    expect(result.commits.map((item) => item.subject)).toEqual(['最近二进制提交', '最近文本提交'])
    expect(result.commits.every((item) => item.repository_id === 1)).toBe(true)
    expect(result.commits.every((item) => item.committed_at.endsWith('Z'))).toBe(true)
    expect(result.commits.find((item) => item.subject === '最近文本提交')).toMatchObject({
      file_count: 1,
      additions: 3,
      deletions: 0
    })
    expect(result.commits.find((item) => item.subject === '最近二进制提交')).toMatchObject({
      file_count: 1,
      additions: 0,
      deletions: 0
    })
  })

  it('通过唯一键在增量重叠扫描时保持提交幂等', async () => {
    const directory = createGitRepository()
    const { database, context } = createDatabase()
    const service = new RepositoryService(database, context)
    const repository = service.create({ name: '扫描仓库', local_path: directory })

    const first = await service.scanOne(repository.public_id, new Date().toISOString())
    const second = await service.scanOne(repository.public_id, new Date().toISOString())

    expect(first.status).toBe('succeeded')
    expect(first.inserted_count).toBe(2)
    expect(second.status).toBe('succeeded')
    expect(second.inserted_count).toBe(0)
    expect(database.prepare('SELECT COUNT(*) AS count FROM git_commits').get()).toEqual({ count: 2 })
    const commit = database.prepare('SELECT public_id FROM git_commits ORDER BY id LIMIT 1').get() as { public_id: string }
    const outbox = database.prepare(`
      SELECT entity_public_id, payload FROM sync_operations
      WHERE entity_type = 'git_commit'
      ORDER BY id LIMIT 1
    `).get() as { entity_public_id: string; payload: string }
    expect(outbox.entity_public_id).toBe(commit.public_id)
    expect(JSON.parse(outbox.payload)).toMatchObject({ repository_id: repository.public_id })
    expect(service.get(repository.public_id)?.branch).toBeTruthy()
    database.close()
  })

  it('两个 RepositoryService 实例不会并发扫描同一工作区仓库', async () => {
    const directory = createGitRepository()
    const { database, context } = createDatabase()
    const firstRepositoryService = new RepositoryService(database, context, {
      scan: async () => {
        await new Promise((resolve) => setTimeout(resolve, 40))
        return { root_path: directory, branch: 'main', commits: [] }
      }
    } as unknown as GitScanner)
    const secondRepositoryService = new RepositoryService(database, context, {
      scan: async () => ({ root_path: directory, branch: 'main', commits: [] })
    } as unknown as GitScanner)
    const repository = firstRepositoryService.create({ name: '并发仓库', local_path: directory })

    const [first, second] = await Promise.all([
      firstRepositoryService.scanOne(repository.public_id),
      secondRepositoryService.scanOne(repository.public_id)
    ])

    expect([first.status, second.status].sort()).toEqual(['skipped', 'succeeded'])
    database.close()
  })

  it('项目软删除后仓库返回为未归属', () => {
    const directory = createGitRepository()
    const { database, context } = createDatabase()
    const projects = new ProjectService(database, context)
    const repositories = new RepositoryService(database, context)
    const project = projects.create({ name: '将被归档', description: '', color: '#64748b' })
    const repository = repositories.create({ name: '归档项目仓库', local_path: directory, project_id: project.public_id })

    projects.softDelete(project.public_id)

    expect(repositories.list().items.find((item) => item.public_id === repository.public_id)?.project_id).toBeNull()
    database.close()
  })

  it('创建仓库时保留项目归属，编辑仓库信息不会意外清空项目', () => {
    const directory = createGitRepository()
    const { database, context } = createDatabase()
    const projects = new ProjectService(database, context)
    const repositories = new RepositoryService(database, context)
    const project = projects.create({ name: '仓库所属项目', description: '', color: '#64748b' })

    const repository = repositories.create({ name: '已归属仓库', local_path: directory, project_id: project.public_id })
    expect(repository.project_id).toBe(project.public_id)

    const updated = repositories.update(repository.public_id, { name: '编辑后的仓库' })
    expect(updated?.project_id).toBe(project.public_id)
    expect(repositories.get(repository.public_id)?.project_id).toBe(project.public_id)
    database.close()
  })

  it('在一个事务中应用仓库的组合更新 patch', () => {
    const directory = createGitRepository()
    const { database, context } = createDatabase()
    const projects = new ProjectService(database, context)
    const repositories = new RepositoryService(database, context)
    const project = projects.create({ name: '组合更新项目', description: '', color: '#64748b' })
    const repository = repositories.create({ name: '组合更新仓库', local_path: directory })

    const updated = repositories.update(repository.public_id, {
      project_id: project.public_id,
      enabled: false,
      scan_interval_minutes: 15
    } as never)

    expect(updated).toMatchObject({ project_id: project.public_id, enabled: false, scan_interval_minutes: 15 })
    expect(database.prepare('SELECT COUNT(*) AS count FROM sync_operations WHERE entity_type = ? AND entity_public_id = ?').get('repository', repository.public_id))
      .toEqual({ count: 2 })
    database.close()
  })

  it('编辑仓库名称和路径时清空旧分支与扫描游标', () => {
    const directory = createGitRepository()
    const nextDirectory = createTemporaryDirectory('workpulse-git-next-')
    const { database, context } = createDatabase()
    const repositories = new RepositoryService(database, context)
    const repository = repositories.create({ name: '待编辑仓库', local_path: directory })
    database.prepare('UPDATE repository_bindings SET branch = ?, updated_at = ? WHERE repository_id = ?').run('main', new Date().toISOString(), repository.public_id)
    database.prepare('UPDATE repositories SET last_scanned_at = ? WHERE public_id = ?').run(new Date().toISOString(), repository.public_id)

    const updated = repositories.update(repository.public_id, {
      name: '已编辑仓库',
      local_path: nextDirectory,
      remote_url: 'https://example.test/repository.git'
    })

    expect(updated).toMatchObject({ name: '已编辑仓库', local_path: nextDirectory, remote_url: 'https://example.test/repository.git', branch: null, last_scanned_at: null })
    database.close()
  })

  it('仅编辑仓库其他字段且路径未变化时保留分支与扫描游标', () => {
    const directory = createGitRepository()
    const { database, context } = createDatabase()
    const repositories = new RepositoryService(database, context)
    const repository = repositories.create({ name: '保留状态仓库', local_path: directory })
    const originalScannedAt = '2026-08-20T00:00:00.000Z'
    database.prepare('UPDATE repository_bindings SET branch = ?, updated_at = ? WHERE repository_id = (SELECT id FROM repositories WHERE public_id = ?)')
      .run('main', originalScannedAt, repository.public_id)
    database.prepare('UPDATE repositories SET last_scanned_at = ? WHERE public_id = ?')
      .run(originalScannedAt, repository.public_id)

    const updated = repositories.update(repository.public_id, {
      name: '只改名称',
      local_path: directory
    })

    expect(updated).toMatchObject({
      name: '只改名称',
      local_path: directory,
      branch: 'main',
      last_scanned_at: originalScannedAt
    })
    database.close()
  })

  it('软删除仓库跟踪项但保留本地目录和可恢复的数据库记录', () => {
    const directory = createGitRepository()
    const { database, context } = createDatabase()
    const repositories = new RepositoryService(database, context)
    const repository = repositories.create({ name: '待删除仓库', local_path: directory })

    const deleted = repositories.softDelete(repository.public_id)

    expect(deleted).toMatchObject({ public_id: repository.public_id, name: '待删除仓库' })
    expect(repositories.get(repository.public_id)).toBeNull()
    expect(repositories.list()).toMatchObject({ items: [], total: 0 })
    expect(existsSync(directory)).toBe(true)
    expect(database.prepare('SELECT deleted_at FROM repositories WHERE public_id = ?').get(repository.public_id)).toMatchObject({ deleted_at: expect.any(String) })
    expect(database.prepare('SELECT deleted_at FROM repository_bindings WHERE repository_id = (SELECT id FROM repositories WHERE public_id = ?)').get(repository.public_id)).toMatchObject({ deleted_at: expect.any(String) })
    expect(database.prepare('SELECT operation_type FROM sync_operations WHERE entity_type = ? AND entity_public_id = ? ORDER BY id DESC LIMIT 1').get('repository', repository.public_id)).toEqual({ operation_type: 'delete' })
    database.close()
  })

  it('对无效仓库保存失败状态且不阻断其他仓库扫描', async () => {
    const directory = createGitRepository()
    const { database, context } = createDatabase()
    const service = new RepositoryService(database, context)
    const valid = service.create({ name: '有效仓库', local_path: directory })
    const invalid = service.create({ name: '无效仓库', local_path: join(directory, 'missing') })

    const results = await service.scanAllEnabled(new Date().toISOString())

    expect(results.find((result) => result.repository_id === valid.public_id)?.status).toBe('succeeded')
    expect(results.find((result) => result.repository_id === invalid.public_id)).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('Git')
    })
    expect(database.prepare('SELECT last_scanned_at FROM repositories WHERE public_id = ?').get(valid.public_id))
      .toEqual({ last_scanned_at: expect.stringMatching(/Z$/) })
    expect(database.prepare('SELECT last_scanned_at, last_failed_at, last_scan_error FROM repositories WHERE public_id = ?').get(invalid.public_id))
      .toEqual({
        last_scanned_at: null,
        last_failed_at: expect.stringMatching(/Z$/),
        last_scan_error: expect.stringContaining('Git')
      })
    database.close()
  })

  it('numstat 异常时服务失败且不推进游标或写入提交 outbox', async () => {
    const directory = createGitRepository()
    const { database, context } = createDatabase()
    const malformedScanner = {
      scan: async () => {
        throw new GitReadError('提交统计格式无效')
      }
    }
    const service = new RepositoryService(database, context, malformedScanner as unknown as GitScanner)
    const repository = service.create({ name: '异常统计仓库', local_path: directory })
    const originalScannedAt = '2026-08-20T00:00:00.000Z'
    database.prepare('UPDATE repositories SET last_scanned_at = ? WHERE public_id = ?')
      .run(originalScannedAt, repository.public_id)

    const result = await service.scanOne(repository.public_id, '2026-08-23T00:00:00.000Z')

    expect(result).toMatchObject({ status: 'failed', error: '提交统计格式无效' })
    expect(database.prepare('SELECT last_scanned_at FROM repositories WHERE public_id = ?').get(repository.public_id))
      .toEqual({ last_scanned_at: originalScannedAt })
    expect(database.prepare('SELECT COUNT(*) AS count FROM git_commits').get()).toEqual({ count: 0 })
    expect(database.prepare("SELECT COUNT(*) AS count FROM sync_operations WHERE entity_type = 'git_commit'").get())
      .toEqual({ count: 0 })
    database.close()
  })

  it('停止调度器后不启动新的扫描', async () => {
    let calls = 0
    const scheduler = new RepositoryScheduler({
      scanAllEnabled: async () => {
        calls += 1
        return []
      }
    } as unknown as RepositoryService, 5)

    scheduler.start()
    scheduler.stop()
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(calls).toBe(0)
  })
})

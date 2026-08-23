import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { openDatabase, runMigrations } from '../../src/main/database/connection'
import type { WorkspaceContext } from '../../src/main/repositories/contracts'
import { GitScanner } from '../../src/main/git/gitScanner'
import { RepositoryService } from '../../src/main/services/repositoryService'

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
})

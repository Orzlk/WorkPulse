import { resolve } from 'node:path'

import { GitCommand, GitReadError, type GitCommandExecutor } from './gitCommand'

const FIELD_SEPARATOR = '\u001f'
const RECORD_SEPARATOR = '\u001e'

export interface GitRepository {
  id: number
  public_id: string
}

export interface RepositoryBinding {
  id: number
  repository_id: number
  local_path: string
  branch?: string | null
}

export interface GitCommitSummary {
  repository_id: number
  commit_hash: string
  author_name: string
  author_email: string
  committed_at: string
  branch: string
  subject: string
  file_count: number
  additions: number
  deletions: number
}

export interface GitScanOptions {
  since?: string
  until?: string
}

export interface GitScanResult {
  root_path: string
  branch: string
  commits: GitCommitSummary[]
}

interface TimeRange {
  sinceMs?: number
  untilMs?: number
}

function sanitizeField(value: string): string {
  return value.replace(/[\r\n\u001e\u001f]/g, ' ').trim()
}

function parseBoundary(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) throw new GitReadError(`${name} 时间无效`)
  return timestamp
}

function parseTimeRange(options: GitScanOptions): TimeRange {
  const sinceMs = parseBoundary(options.since, 'since')
  const untilMs = parseBoundary(options.until, 'until')
  if (sinceMs !== undefined && untilMs !== undefined && sinceMs >= untilMs) {
    throw new GitReadError('Git 扫描时间范围无效')
  }
  return { sinceMs, untilMs }
}

function toUtcIso(value: string): { iso: string; timestamp: number } {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new GitReadError('提交时间无效')
  return { iso: date.toISOString(), timestamp: date.getTime() }
}

function parseCount(value: string): number {
  const count = Number.parseInt(value, 10)
  return Number.isFinite(count) ? count : 0
}

function summarizeNumstat(lines: string[]): Pick<GitCommitSummary, 'file_count' | 'additions' | 'deletions'> {
  let fileCount = 0
  let additions = 0
  let deletions = 0
  for (const line of lines) {
    if (!line) continue
    const [added, removed, filePath] = line.split('\t', 3)
    if (added === undefined || removed === undefined || filePath === undefined) {
      throw new GitReadError('提交统计格式无效')
    }
    fileCount += 1
    additions += added === '-' ? 0 : parseCount(added)
    deletions += removed === '-' ? 0 : parseCount(removed)
  }
  return { file_count: fileCount, additions, deletions }
}

function parseLog(repositoryId: number, branch: string, output: string, range: TimeRange): GitCommitSummary[] {
  return output
    .split(RECORD_SEPARATOR)
    .map((record) => record.replace(/^\r?\n/, ''))
    .filter(Boolean)
    .flatMap((record) => {
      const [header, ...numstatLines] = record.split(/\r?\n/)
      const fields = header.split(FIELD_SEPARATOR)
      if (fields.length !== 5) throw new GitReadError('提交格式无效')
      const [commitHash, authorName, authorEmail, committedAt, subject] = fields
      if (!/^[0-9a-f]{40}$/i.test(commitHash)) throw new GitReadError('提交格式无效')
      const committedTime = toUtcIso(committedAt)
      if (range.sinceMs !== undefined && committedTime.timestamp < range.sinceMs) return []
      if (range.untilMs !== undefined && committedTime.timestamp >= range.untilMs) return []
      return [{
        repository_id: repositoryId,
        commit_hash: commitHash,
        author_name: sanitizeField(authorName),
        author_email: sanitizeField(authorEmail),
        committed_at: committedTime.iso,
        branch: sanitizeField(branch) || 'HEAD',
        subject: sanitizeField(subject),
        ...summarizeNumstat(numstatLines)
      }]
    })
}

export class GitScanner {
  constructor(private readonly command: GitCommandExecutor = new GitCommand()) {}

  async scan(
    repository: GitRepository,
    binding: RepositoryBinding,
    options: GitScanOptions = {}
  ): Promise<GitScanResult> {
    if (repository.id !== binding.repository_id) {
      throw new GitReadError('Git 仓库绑定无效')
    }

    const workingDirectory = resolve(binding.local_path)
    const range = parseTimeRange(options)
    const rootPath = sanitizeField(await this.command.execute(workingDirectory, ['rev-parse', '--show-toplevel']))
    if (!rootPath) throw new GitReadError('Git 仓库路径无效')
    const branch = sanitizeField(await this.command.execute(workingDirectory, ['rev-parse', '--abbrev-ref', 'HEAD'])) || 'HEAD'
    const args = [
      'log',
      '--no-renames',
      '--numstat',
      `--format=${RECORD_SEPARATOR}%H${FIELD_SEPARATOR}%an${FIELD_SEPARATOR}%ae${FIELD_SEPARATOR}%cI${FIELD_SEPARATOR}%s`
    ]
    if (options.since) args.push(`--since=${options.since}`)
    if (options.until) args.push(`--before=${options.until}`)
    const output = await this.command.execute(workingDirectory, args)

    return { root_path: rootPath, branch, commits: parseLog(repository.id, branch, output, range) }
  }
}

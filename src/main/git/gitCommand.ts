import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const DEFAULT_TIMEOUT_MS = 15_000
const LOG_FORMAT = '--format=\u001e%H\u001f%an\u001f%ae\u001f%cI\u001f%s'
const ISO_BOUNDARY_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

export class GitReadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GitReadError'
  }
}

function toGitReadError(error: unknown): GitReadError {
  const candidate = error as NodeJS.ErrnoException & { killed?: boolean; signal?: string }
  if (candidate.code === 'ENOENT') return new GitReadError('Git 不可用，请安装 Git 后重试')
  if (candidate.code === 'ETIMEDOUT' || candidate.killed || candidate.signal === 'SIGTERM') {
    return new GitReadError('Git 读取超时，请检查仓库状态后重试')
  }
  return new GitReadError('Git 仓库不可读取，请确认路径有效且当前用户具备读取权限')
}

export interface GitCommandExecutor {
  execute(cwd: string, args: string[]): Promise<string>
}

function assertReadOnlyArguments(args: string[]): void {
  const [command, ...rest] = args
  if (command === 'rev-parse') {
    const isRootCheck = rest.length === 1 && rest[0] === '--show-toplevel'
    const isBranchCheck = rest.length === 2 && rest[0] === '--abbrev-ref' && rest[1] === 'HEAD'
    if (isRootCheck || isBranchCheck) return
  }

  if (command === 'log') {
    if (rest.length < 3 || rest.length > 5) throw new GitReadError('Git 命令不在只读允许范围内')
    if (rest[0] !== '--no-renames' || rest[1] !== '--numstat' || rest[2] !== LOG_FORMAT) {
      throw new GitReadError('Git 命令不在只读允许范围内')
    }
    const optionalArguments = rest.slice(3)
    const seen = new Set<string>()
    for (const argument of optionalArguments) {
      const name = argument.startsWith('--since=') ? '--since' : argument.startsWith('--before=') ? '--before' : null
      if (!name || seen.has(name) || !ISO_BOUNDARY_PATTERN.test(argument.slice(name.length + 1))) {
        throw new GitReadError('Git 命令不在只读允许范围内')
      }
      seen.add(name)
    }
    return
  }

  throw new GitReadError('Git 命令不在只读允许范围内')
}

export class GitCommand implements GitCommandExecutor {
  constructor(private readonly timeoutMs = DEFAULT_TIMEOUT_MS) {}

  async execute(cwd: string, args: string[]): Promise<string> {
    assertReadOnlyArguments(args)

    try {
      const { stdout } = await execFileAsync('git', args, {
        cwd,
        timeout: this.timeoutMs,
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024
      })
      return stdout
    } catch (error) {
      throw toGitReadError(error)
    }
  }
}

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const READ_ONLY_COMMANDS = new Set(['rev-parse', 'log'])
const DEFAULT_TIMEOUT_MS = 15_000

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

export class GitCommand implements GitCommandExecutor {
  constructor(private readonly timeoutMs = DEFAULT_TIMEOUT_MS) {}

  async execute(cwd: string, args: string[]): Promise<string> {
    if (!READ_ONLY_COMMANDS.has(args[0])) {
      throw new GitReadError('Git 命令不在只读允许范围内')
    }

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

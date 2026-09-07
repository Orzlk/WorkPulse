import { invalid } from '../ipcContracts'

export type TaskBoardStatus = 'todo' | 'in_progress' | 'done' | 'draft'

const SYSTEM_COLUMNS = new Set<TaskBoardStatus>(['todo', 'in_progress', 'done', 'draft'])

export function normalizeTaskBoardState(boardColumn: string, status: TaskBoardStatus | undefined): {
  boardColumn: string
  status: TaskBoardStatus
} {
  if (SYSTEM_COLUMNS.has(boardColumn as TaskBoardStatus)) {
    const expected = boardColumn as TaskBoardStatus
    if (status !== undefined && status !== expected) throw invalid('board_column and status must match')
    return { boardColumn, status: expected }
  }
  if (!status) return { boardColumn, status: 'in_progress' }
  return { boardColumn, status }
}

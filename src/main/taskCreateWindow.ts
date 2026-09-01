export const TASK_CREATE_WINDOW = 'task-create'

export interface TaskCreateTitleBarOverlayOptions {
  color: string
  symbolColor: string
  height: number
}

/** 与 ui-system 画布/文本 Token 对齐，供 Windows/Linux 的系统标题栏 overlay 使用。 */
export function buildTaskCreateTitleBarOverlay(isDark: boolean): TaskCreateTitleBarOverlayOptions {
  return isDark
    ? { color: '#17191d', symbolColor: '#f4f5f6', height: 36 }
    : { color: '#f7f8fa', symbolColor: '#303236', height: 36 }
}

export function buildTaskCreateQuery(): string {
  const params = new URLSearchParams({ window: TASK_CREATE_WINDOW })
  return `?${params.toString()}`
}

export function parseTaskCreateQuery(search: string): boolean {
  return new URLSearchParams(search).get('window') === TASK_CREATE_WINDOW
}

export function shouldPromptTaskCreateClose(isDirty: boolean, isQuitting: boolean): boolean {
  return isDirty && !isQuitting
}

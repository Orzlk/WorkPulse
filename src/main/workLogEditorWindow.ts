export const WORK_LOG_EDITOR_WINDOW = 'worklog-editor'

export function buildWorkLogEditorQuery(publicId: string): string {
  const params = new URLSearchParams({ window: WORK_LOG_EDITOR_WINDOW, log: publicId })
  return `?${params.toString()}`
}

export function parseWorkLogEditorQuery(search: string): string | null {
  const params = new URLSearchParams(search)
  if (params.get('window') !== WORK_LOG_EDITOR_WINDOW) return null
  const publicId = params.get('log')?.trim()
  return publicId || null
}

export function shouldPromptWorkLogEditorClose(isDirty: boolean, isQuitting: boolean): boolean {
  return isDirty && !isQuitting
}

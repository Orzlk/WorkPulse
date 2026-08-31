export const TASK_CREATE_WINDOW = 'task-create'

export function buildTaskCreateQuery(): string {
  const params = new URLSearchParams({ window: TASK_CREATE_WINDOW })
  return `?${params.toString()}`
}

export function parseTaskCreateQuery(search: string): boolean {
  return new URLSearchParams(search).get('window') === TASK_CREATE_WINDOW
}

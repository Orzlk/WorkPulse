export interface TaskCreateRoute {
  isTaskCreate: boolean
}

export function parseTaskCreateRoute(search: string): TaskCreateRoute {
  return { isTaskCreate: new URLSearchParams(search).get('window') === 'task-create' }
}

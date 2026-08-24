export interface WorkLogEditorRoute {
  isEditor: boolean
  publicId: string | null
}

export function parseWorkLogEditorRoute(search: string): WorkLogEditorRoute {
  const params = new URLSearchParams(search)
  if (params.get('window') !== 'worklog-editor') {
    return { isEditor: false, publicId: null }
  }

  const publicId = params.get('log')?.trim()
  return publicId ? { isEditor: true, publicId } : { isEditor: false, publicId: null }
}

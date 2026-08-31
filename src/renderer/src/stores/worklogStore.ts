import { create } from 'zustand'
import type { WorkItemAssociations } from '../lib/workspaceTypes'
import { createLatestRequestGate } from '../lib/workspaceInteractions'

interface WorkLog {
  id: number
  content: string
  category: string
  created_at: string
  task_id: number | null
  public_id: string
  project_id: string | null
  tag_names: string[]
}

interface WorkLogStore {
  logs: WorkLog[]
  loading: boolean
  hasMore: boolean
  searchKeyword: string
  tagFilter: string
  projectFilter: string
  lastDeleted: WorkLog | null
  fetchLogs: (tagPath?: string, projectPublicId?: string) => Promise<void>
  loadByPublicId: (publicId: string) => Promise<WorkLog | null>
  loadMore: () => Promise<void>
  searchLogs: (keyword: string, tagPath?: string, projectPublicId?: string) => Promise<void>
  setTagFilter: (tagPath: string) => Promise<void>
  setProjectFilter: (projectPublicId: string) => Promise<void>
  clearSearch: () => Promise<void>
  addLog: (content: string, category?: string, associations?: WorkItemAssociations) => Promise<WorkLog>
  deleteLog: (id: number) => Promise<void>
  undoDelete: () => Promise<void>
  dismissUndo: () => void
  updateLog: (id: number, content: string, category: string, created_at?: string, associations?: WorkItemAssociations) => Promise<void>
}

const PAGE_SIZE = 50
const searchGate = createLatestRequestGate()

export const useWorkLogStore = create<WorkLogStore>((set, get) => ({
  logs: [],
  loading: false,
  hasMore: true,
  searchKeyword: '',
  tagFilter: '',
  projectFilter: '',
  lastDeleted: null,

  fetchLogs: async (tagPath = get().tagFilter, projectPublicId = get().projectFilter) => {
    set({ loading: true, tagFilter: tagPath, projectFilter: projectPublicId })
    try {
      const logs = await window.api.worklog.list(PAGE_SIZE, 0, tagPath || undefined, projectPublicId || undefined)
      set({ logs, hasMore: logs.length >= PAGE_SIZE })
    } finally {
      set({ loading: false })
    }
  },

  loadByPublicId: async (publicId) => {
    const log = await window.api.worklog.get(publicId)
    if (!log) return null
    set((state) => ({
      logs: [log, ...state.logs.filter((item) => item.public_id !== log.public_id)].sort((a, b) => b.created_at.localeCompare(a.created_at))
    }))
    return log
  },

  loadMore: async () => {
    if (get().loading || !get().hasMore || get().searchKeyword) return
    set({ loading: true })
    try {
      const more = await window.api.worklog.list(PAGE_SIZE, get().logs.length, get().tagFilter || undefined, get().projectFilter || undefined)
      set({
        logs: [...get().logs, ...more],
        hasMore: more.length >= PAGE_SIZE
      })
    } finally {
      set({ loading: false })
    }
  },

  searchLogs: async (keyword: string, tagPath = get().tagFilter, projectPublicId = get().projectFilter) => {
    const requestId = searchGate.next()
    set({ loading: true, searchKeyword: keyword, tagFilter: tagPath, projectFilter: projectPublicId })
    try {
      const logs = await window.api.worklog.search(keyword, tagPath || undefined, projectPublicId || undefined)
      if (searchGate.isCurrent(requestId)) set({ logs })
    } finally {
      if (searchGate.isCurrent(requestId)) set({ loading: false })
    }
  },

  clearSearch: async () => {
    searchGate.next()
    set({ searchKeyword: '' })
    await get().fetchLogs(get().tagFilter, get().projectFilter)
  },

  setTagFilter: async (tagPath: string) => {
    set({ tagFilter: tagPath })
    if (get().searchKeyword) {
      await get().searchLogs(get().searchKeyword, tagPath, get().projectFilter)
    } else {
      await get().fetchLogs(tagPath, get().projectFilter)
    }
  },

  setProjectFilter: async (projectPublicId: string) => {
    set({ projectFilter: projectPublicId })
    if (get().searchKeyword) {
      await get().searchLogs(get().searchKeyword, get().tagFilter, projectPublicId)
    } else {
      await get().fetchLogs(get().tagFilter, projectPublicId)
    }
  },

  addLog: async (content: string, category?: string, associations?: WorkItemAssociations) => {
    const log = await window.api.worklog.add(content, category, associations)
    // If searching, re-run search; otherwise prepend
    if (get().searchKeyword) {
      await get().searchLogs(get().searchKeyword, get().tagFilter, get().projectFilter)
    } else if (get().tagFilter || get().projectFilter) {
      await get().fetchLogs(get().tagFilter, get().projectFilter)
    } else {
      set({ logs: [log, ...get().logs] })
    }
    return log
  },

  deleteLog: async (id: number) => {
    const deleted = get().logs.find((l) => l.id === id)
    await window.api.worklog.delete(id)
    set({ logs: get().logs.filter((l) => l.id !== id), lastDeleted: deleted || null })
  },

  undoDelete: async () => {
    const deleted = get().lastDeleted
    if (!deleted) return
    await window.api.worklog.restore(deleted)
    set({ lastDeleted: null })
    // Refresh to get correct ordering
    if (get().searchKeyword) {
      await get().searchLogs(get().searchKeyword, get().tagFilter, get().projectFilter)
    } else if (get().tagFilter || get().projectFilter) {
      await get().fetchLogs(get().tagFilter, get().projectFilter)
    } else {
      await get().fetchLogs()
    }
  },

  dismissUndo: () => {
    set({ lastDeleted: null })
  },

  updateLog: async (id: number, content: string, category: string, created_at?: string, associations?: WorkItemAssociations) => {
    const updated = await window.api.worklog.update(id, content, category, created_at, associations)
    if (updated) {
      if (get().searchKeyword) {
        await get().searchLogs(get().searchKeyword, get().tagFilter, get().projectFilter)
        return
      }
      if (get().tagFilter || get().projectFilter) {
        await get().fetchLogs(get().tagFilter, get().projectFilter)
        return
      }
      const logs = get()
        .logs.map((log) => (log.id === id ? updated : log))
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
      set({ logs })
    }
  }
}))

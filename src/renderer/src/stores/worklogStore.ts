import { create } from 'zustand'
import type { WorkItemAssociations } from '../lib/workspaceTypes'
import { createLatestRequestGate, mergePage } from '../lib/workspaceInteractions'

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
  error: string | null
  hasMore: boolean
  nextOffset: number
  searchKeyword: string
  tagFilter: string
  projectFilter: string
  lastDeleted: WorkLog | null
  deletedLogs: WorkLog[]
  pinnedPublicIds: string[]
  fetchLogs: (tagPath?: string, projectPublicId?: string) => Promise<void>
  loadByPublicId: (publicId: string) => Promise<WorkLog | null>
  loadMore: () => Promise<void>
  searchLogs: (keyword: string, tagPath?: string, projectPublicId?: string) => Promise<void>
  setTagFilter: (tagPath: string) => Promise<void>
  setProjectFilter: (projectPublicId: string) => Promise<void>
  clearSearch: () => Promise<void>
  addLog: (content: string, category?: string, associations?: WorkItemAssociations) => Promise<WorkLog>
  deleteLog: (id: number) => Promise<void>
  undoDelete: (id?: number) => Promise<void>
  dismissUndo: () => void
  updateLog: (id: number, content: string, category: string, created_at?: string, associations?: WorkItemAssociations) => Promise<void>
}

const PAGE_SIZE = 50
const requestGate = createLatestRequestGate()

export const useWorkLogStore = create<WorkLogStore>((set, get) => ({
  logs: [],
  loading: false,
  error: null,
  hasMore: true,
  nextOffset: 0,
  searchKeyword: '',
  tagFilter: '',
  projectFilter: '',
  lastDeleted: null,
  deletedLogs: [],
  pinnedPublicIds: [],

  fetchLogs: async (tagPath = get().tagFilter, projectPublicId = get().projectFilter) => {
    const requestId = requestGate.next()
    set({ loading: true, tagFilter: tagPath, projectFilter: projectPublicId, pinnedPublicIds: [] })
    try {
      const logs = await window.api.worklog.list(PAGE_SIZE, 0, tagPath || undefined, projectPublicId || undefined)
      if (requestGate.isCurrent(requestId)) {
        const current = get()
        const pinnedLogs = current.pinnedPublicIds
          .map((id) => current.logs.find((log) => log.public_id === id))
          .filter((log): log is WorkLog => Boolean(log))
        const merged = mergePage(pinnedLogs, logs, Number.MAX_SAFE_INTEGER)
        const incomingIds = new Set(logs.map((log) => log.public_id))
        set({ logs: merged.items, hasMore: logs.length >= PAGE_SIZE, nextOffset: logs.length, error: null, pinnedPublicIds: current.pinnedPublicIds.filter((id) => !incomingIds.has(id)) })
      }
    } catch (error) {
      if (requestGate.isCurrent(requestId)) set({ error: 'worklog.saveError' })
    } finally {
      if (requestGate.isCurrent(requestId)) set({ loading: false })
    }
  },

  loadByPublicId: async (publicId) => {
    const log = await window.api.worklog.get(publicId)
    if (!log) return null
    set((state) => ({
      logs: [log, ...state.logs.filter((item) => item.public_id !== log.public_id)].sort((a, b) => b.created_at.localeCompare(a.created_at)),
      pinnedPublicIds: state.logs.some((item) => item.public_id === log.public_id) ? state.pinnedPublicIds : [...state.pinnedPublicIds, log.public_id]
    }))
    return log
  },

  loadMore: async () => {
    if (get().loading || !get().hasMore || get().searchKeyword) return
    const state = get()
    const requestId = requestGate.next()
    const offset = state.nextOffset
    const tagPath = state.tagFilter
    const projectPublicId = state.projectFilter
    set({ loading: true })
    try {
      const more = await window.api.worklog.list(PAGE_SIZE, offset, tagPath || undefined, projectPublicId || undefined)
      if (requestGate.isCurrent(requestId)) {
        const current = get()
        const merged = mergePage(current.logs, more, Number.MAX_SAFE_INTEGER)
        const incomingIds = new Set(more.map((log) => log.public_id))
        set({ logs: merged.items, hasMore: more.length >= PAGE_SIZE, nextOffset: offset + more.length, pinnedPublicIds: current.pinnedPublicIds.filter((id) => !incomingIds.has(id)), error: null })
      }
    } catch (error) {
      if (requestGate.isCurrent(requestId)) set({ error: 'worklog.saveError' })
    } finally {
      if (requestGate.isCurrent(requestId)) set({ loading: false })
    }
  },

  searchLogs: async (keyword: string, tagPath = get().tagFilter, projectPublicId = get().projectFilter) => {
    const requestId = requestGate.next()
    set({ loading: true, searchKeyword: keyword, tagFilter: tagPath, projectFilter: projectPublicId })
    try {
      const logs = await window.api.worklog.search(keyword, tagPath || undefined, projectPublicId || undefined)
      if (requestGate.isCurrent(requestId)) set({ logs, hasMore: false, nextOffset: logs.length, error: null, pinnedPublicIds: [] })
    } catch (error) {
      if (requestGate.isCurrent(requestId)) set({ error: 'worklog.saveError' })
    } finally {
      if (requestGate.isCurrent(requestId)) set({ loading: false })
    }
  },

  clearSearch: async () => {
    requestGate.next()
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
      set({ logs: [log, ...get().logs], nextOffset: get().nextOffset + 1 })
    }
    return log
  },

  deleteLog: async (id: number) => {
    const deleted = get().logs.find((l) => l.id === id)
    await window.api.worklog.delete(id)
    const deletedLogs = deleted ? [deleted, ...get().deletedLogs.filter((log) => log.id !== id)].slice(0, 10) : get().deletedLogs
    set({ logs: get().logs.filter((l) => l.id !== id), lastDeleted: deleted ?? get().lastDeleted, deletedLogs })
  },

  undoDelete: async (id) => {
    const deleted = get().deletedLogs.find((log) => log.id === id) ?? (id === undefined ? get().lastDeleted : null)
    if (!deleted) return
    await window.api.worklog.restore(deleted)
    const deletedLogs = get().deletedLogs.filter((log) => log.id !== deleted.id)
    set({ lastDeleted: deletedLogs[0] ?? null, deletedLogs })
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
    set({ lastDeleted: null, deletedLogs: [] })
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

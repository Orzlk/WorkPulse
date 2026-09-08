import { create } from 'zustand'
import { mergePage } from '../lib/workspaceInteractions'
import type { AsyncStatus, InboxFilter, InboxItem } from '../lib/workspaceTypes'

const PAGE_SIZE = 40
let fetchPromise: Promise<void> | null = null
type InboxInput = Pick<InboxItem, 'content' | 'project_id' | 'include_in_reports'> & {
  tag_names: string[]
  ai_suggestion: InboxItem['ai_suggestion']
}

interface InboxStore {
  items: InboxItem[]
  total: number
  pinnedPublicIds: string[]
  status: AsyncStatus
  error: string | null
  selectedId: string | null
  filter: InboxFilter
  fetch: (filter?: InboxFilter) => Promise<void>
  loadMore: () => Promise<void>
  setFilter: (filter: InboxFilter) => Promise<void>
  loadByPublicId: (publicId: string) => Promise<InboxItem | null>
  select: (publicId: string | null) => void
  create: (input: InboxInput) => Promise<InboxItem>
  suggestAi: (input?: { public_ids?: string[]; limit?: number }) => Promise<{ processed: number; updated: number; failed: number }>
  organize: (publicId: string, options?: { target: 'work_log' | 'task' | 'ignore'; project_id?: string | null; tag_names?: string[]; title?: string; include_in_reports?: boolean }) => Promise<void>
  ignore: (publicId: string) => Promise<void>
  remove: (publicId: string) => Promise<void>
}

export const useInboxStore = create<InboxStore>((set, get) => ({
  items: [], total: 0, pinnedPublicIds: [], status: 'idle', error: null, selectedId: null, filter: 'all',
  fetch: async (nextFilter = get().filter) => {
    if (fetchPromise) return fetchPromise
    fetchPromise = (async () => {
      set({ status: 'running', error: null })
      try {
        const page = await window.api.inbox.list({ limit: PAGE_SIZE, offset: 0, state: nextFilter === 'all' ? undefined : nextFilter })
        set({ items: page.items, total: page.total, pinnedPublicIds: [], status: 'success', filter: nextFilter })
      } catch (error) {
        set({ status: 'error', error: 'workspace.errorInboxLoad' })
      }
    })()
    try { await fetchPromise } finally { fetchPromise = null }
  },
  loadMore: async () => {
    const state = get()
    const offset = Math.max(0, state.items.length - state.pinnedPublicIds.length)
    if (state.status === 'running' || offset >= state.total) return
    set({ status: 'running', error: null })
    try {
      const page = await window.api.inbox.list({ limit: PAGE_SIZE, offset, state: state.filter === 'all' ? undefined : state.filter })
      const merged = mergePage(state.items, page.items, page.total)
      set({ ...merged, total: page.total, status: 'success' })
    } catch (error) {
      set({ status: 'error', error: 'workspace.errorInboxLoad' })
    }
  },
  setFilter: async (filter) => {
    if (filter === get().filter && get().status === 'success') return
    await get().fetch(filter)
  },
  loadByPublicId: async (publicId) => {
    const item = await window.api.inbox.get(publicId)
    if (!item) return null
    set((state) => ({
      items: [item, ...state.items.filter((current) => current.public_id !== item.public_id)],
      total: Math.max(state.total, 1),
      pinnedPublicIds: state.items.some((current) => current.public_id === item.public_id)
        ? state.pinnedPublicIds
        : [...state.pinnedPublicIds, item.public_id],
      status: 'success'
    }))
    return item
  },
  select: (publicId) => set({ selectedId: publicId }),
  create: async (input) => {
    const item = await window.api.inbox.create(input)
    const state = get()
    if (state.filter === 'all' || state.filter === item.state) {
      set({ items: [item, ...state.items], total: state.total + 1, status: 'success' })
    }
    return item
  },
  suggestAi: async (input) => {
    const result = await window.api.inbox.aiOrganize(input)
    const state = get()
    const page = await window.api.inbox.list({ limit: PAGE_SIZE, offset: 0, state: state.filter === 'all' ? undefined : state.filter })
    set({ items: page.items, total: page.total, status: 'success', selectedId: null })
    return { processed: result.processed, updated: result.updated, failed: result.failed }
  },
  organize: async (publicId, options) => {
    await window.api.inbox.organize(publicId, options)
    await get().fetch()
    set({ selectedId: null })
  },
  ignore: async (publicId) => {
    await window.api.inbox.ignore(publicId)
    await get().fetch()
    set({ selectedId: null })
  },
  remove: async (publicId) => {
    await window.api.inbox.delete(publicId)
    await get().fetch()
    set({ selectedId: null })
  }
}))

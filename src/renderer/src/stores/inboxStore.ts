import { create } from 'zustand'
import { createLatestRequestGate, mergePage } from '../lib/workspaceInteractions'
import type { AsyncStatus, InboxFilter, InboxItem } from '../lib/workspaceTypes'

const PAGE_SIZE = 40
const requestGate = createLatestRequestGate()
const lookupGate = createLatestRequestGate()
type InboxInput = Pick<InboxItem, 'content' | 'project_id' | 'include_in_reports'> & {
  tag_names: string[]
  ai_suggestion: InboxItem['ai_suggestion']
}

interface InboxStore {
  items: InboxItem[]
  total: number
  nextOffset: number
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
  items: [], total: 0, nextOffset: 0, pinnedPublicIds: [], status: 'idle', error: null, selectedId: null, filter: 'all',
  fetch: async (nextFilter = get().filter) => {
    const requestId = requestGate.next()
    set({ status: 'running', error: null, filter: nextFilter, pinnedPublicIds: [] })
    try {
      const page = await window.api.inbox.list({ limit: PAGE_SIZE, offset: 0, state: nextFilter === 'all' ? undefined : nextFilter })
      if (requestGate.isCurrent(requestId)) {
        const current = get()
        const pinnedItems = current.pinnedPublicIds
          .map((id) => current.items.find((item) => item.public_id === id))
          .filter((item): item is InboxItem => Boolean(item))
        const merged = mergePage(pinnedItems, page.items, page.total)
        const incomingIds = new Set(page.items.map((item) => item.public_id))
        set({ items: merged.items, total: page.total, nextOffset: page.items.length, pinnedPublicIds: current.pinnedPublicIds.filter((id) => !incomingIds.has(id)), status: 'success' })
      }
    } catch (error) {
      if (requestGate.isCurrent(requestId)) set({ status: 'error', error: 'workspace.errorInboxLoad' })
    }
  },
  loadMore: async () => {
    const state = get()
    const offset = state.nextOffset
    if (state.status === 'running' || offset >= state.total) return
    const requestId = requestGate.next()
    const filter = state.filter
    set({ status: 'running', error: null })
    try {
      const page = await window.api.inbox.list({ limit: PAGE_SIZE, offset, state: filter === 'all' ? undefined : filter })
      if (!requestGate.isCurrent(requestId)) return
      const current = get()
      const merged = mergePage(current.items, page.items, page.total)
      const incomingIds = new Set(page.items.map((item) => item.public_id))
      set({ items: merged.items, total: page.total, nextOffset: offset + page.items.length, pinnedPublicIds: current.pinnedPublicIds.filter((id) => !incomingIds.has(id)), status: 'success', error: null })
    } catch (error) {
      if (requestGate.isCurrent(requestId)) set({ status: 'error', error: 'workspace.errorInboxLoad' })
    }
  },
  setFilter: async (filter) => {
    if (filter === get().filter && get().status === 'success') return
    await get().fetch(filter)
  },
  loadByPublicId: async (publicId) => {
    const requestId = lookupGate.next()
    const item = await window.api.inbox.get(publicId)
    if (!item || !lookupGate.isCurrent(requestId)) return null
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
      set({ items: [item, ...state.items], total: state.total + 1, nextOffset: state.nextOffset + 1, status: 'success' })
    }
    return item
  },
  suggestAi: async (input) => {
    const result = await window.api.inbox.aiOrganize(input)
    const state = get()
    const requestId = requestGate.next()
    const page = await window.api.inbox.list({ limit: PAGE_SIZE, offset: 0, state: state.filter === 'all' ? undefined : state.filter })
    if (requestGate.isCurrent(requestId)) set({ items: page.items, total: page.total, nextOffset: page.items.length, pinnedPublicIds: [], status: 'success', selectedId: null })
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

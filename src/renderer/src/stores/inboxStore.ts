import { create } from 'zustand'
import { mergePage } from '../lib/workspaceInteractions'
import type { AsyncStatus, InboxItem } from '../lib/workspaceTypes'

const PAGE_SIZE = 40
let fetchPromise: Promise<void> | null = null
type InboxInput = Pick<InboxItem, 'content' | 'project_id' | 'repository_id' | 'include_in_reports'> & {
  tag_names: string[]
  ai_suggestion: InboxItem['ai_suggestion']
}

interface InboxStore {
  items: InboxItem[]
  total: number
  status: AsyncStatus
  error: string | null
  selectedId: string | null
  fetch: () => Promise<void>
  loadMore: () => Promise<void>
  loadByPublicId: (publicId: string) => Promise<InboxItem | null>
  select: (publicId: string | null) => void
  create: (input: InboxInput) => Promise<InboxItem>
  organize: (publicId: string) => Promise<void>
  ignore: (publicId: string) => Promise<void>
}

export const useInboxStore = create<InboxStore>((set, get) => ({
  items: [], total: 0, status: 'idle', error: null, selectedId: null,
  fetch: async () => {
    if (fetchPromise) return fetchPromise
    fetchPromise = (async () => {
      set({ status: 'running', error: null })
      try {
        const page = await window.api.inbox.list({ limit: PAGE_SIZE, offset: 0 })
        set({ items: page.items, total: page.total, status: 'success' })
      } catch (error) {
        set({ status: 'error', error: 'workspace.errorInboxLoad' })
      }
    })()
    try { await fetchPromise } finally { fetchPromise = null }
  },
  loadMore: async () => {
    const state = get()
    if (state.status === 'running' || state.items.length >= state.total) return
    set({ status: 'running', error: null })
    try {
      const page = await window.api.inbox.list({ limit: PAGE_SIZE, offset: state.items.length })
      const merged = mergePage(state.items, page.items, page.total)
      set({ ...merged, total: page.total, status: 'success' })
    } catch (error) {
      set({ status: 'error', error: 'workspace.errorInboxLoad' })
    }
  },
  loadByPublicId: async (publicId) => {
    const item = await window.api.inbox.get(publicId)
    if (!item) return null
    set((state) => ({ items: [item, ...state.items.filter((current) => current.public_id !== item.public_id)], total: Math.max(state.total, 1), status: 'success' }))
    return item
  },
  select: (publicId) => set({ selectedId: publicId }),
  create: async (input) => {
    const item = await window.api.inbox.create(input)
    set({ items: [item, ...get().items], total: get().total + 1, status: 'success' })
    return item
  },
  organize: async (publicId) => {
    await window.api.inbox.organize(publicId)
    set({ items: get().items.filter((item) => item.public_id !== publicId), total: Math.max(0, get().total - 1), selectedId: null })
  },
  ignore: async (publicId) => {
    await window.api.inbox.ignore(publicId)
    set({ items: get().items.filter((item) => item.public_id !== publicId), total: Math.max(0, get().total - 1), selectedId: null })
  }
}))

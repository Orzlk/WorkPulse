import { create } from 'zustand'
import { mergePage } from '../lib/workspaceInteractions'
import type { AsyncStatus, Repository } from '../lib/workspaceTypes'

const PAGE_SIZE = 40
let fetchPromise: Promise<void> | null = null

interface RepositoryStore {
  items: Repository[]
  total: number
  pinnedPublicIds: string[]
  status: AsyncStatus
  error: string | null
  fetch: () => Promise<void>
  loadByPublicId: (publicId: string) => Promise<Repository | null>
  loadMore: () => Promise<void>
  create: (input: Parameters<Window['api']['repository']['create']>[0]) => Promise<Repository>
  update: (publicId: string, input: Parameters<Window['api']['repository']['update']>[1]) => Promise<void>
  remove: (publicId: string) => Promise<void>
  scan: (publicId: string) => Promise<{ status: string; inserted_count: number; error?: string }>
  scanAll: () => Promise<{
    succeeded: number
    failed: number
    commits: number
    errors: Array<{ repository_id: string; error: string }>
    results: Array<{ repository_id: string; status: 'succeeded' | 'failed' | 'skipped'; inserted_count: number; error?: string }>
  }>
}

export const useRepositoryStore = create<RepositoryStore>((set, get) => ({
  items: [], total: 0, pinnedPublicIds: [], status: 'idle', error: null,
  fetch: async () => {
    if (fetchPromise) return fetchPromise
    fetchPromise = (async () => {
      set({ status: 'running', error: null })
      try {
        const page = await window.api.repository.list({ limit: PAGE_SIZE, offset: 0 })
        set({ items: page.items, total: page.total, pinnedPublicIds: [], status: 'success' })
      } catch (error) {
        set({ status: 'error', error: 'workspace.errorRepositoriesLoad' })
      }
    })()
    try { await fetchPromise } finally { fetchPromise = null }
  },
  loadByPublicId: async (publicId) => {
    const item = await window.api.repository.get(publicId)
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
  loadMore: async () => {
    const state = get()
    const offset = Math.max(0, state.items.length - state.pinnedPublicIds.length)
    if (state.status === 'running' || offset >= state.total) return
    set({ status: 'running', error: null })
    try {
      const page = await window.api.repository.list({ limit: PAGE_SIZE, offset })
      const merged = mergePage(state.items, page.items, page.total)
      set({ ...merged, total: page.total, status: 'success' })
    } catch (error) {
      set({ status: 'error', error: 'workspace.errorRepositoriesLoad' })
    }
  },
  create: async (input) => {
    const item = await window.api.repository.create(input)
    set({ items: [item, ...get().items], total: get().total + 1, status: 'success' })
    return item
  },
  update: async (publicId, input) => {
    const item = await window.api.repository.update(publicId, input)
    if (item) set({ items: get().items.map((current) => current.public_id === publicId ? item : current) })
  },
  remove: async (publicId) => {
    const item = await window.api.repository.delete(publicId)
    if (!item) return
    set((state) => ({
      items: state.items.filter((current) => current.public_id !== publicId),
      total: Math.max(0, state.total - 1)
    }))
  },
  scan: async (publicId) => {
    const result = await window.api.repository.scan(publicId)
    await get().fetch()
    return result
  },
  scanAll: async () => {
    const result = await window.api.repository.scanAll()
    await get().fetch()
    return result
  }
}))

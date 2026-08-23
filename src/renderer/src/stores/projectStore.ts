import { create } from 'zustand'
import { mergePage } from '../lib/workspaceInteractions'
import type { AsyncStatus, Project } from '../lib/workspaceTypes'

const PAGE_SIZE = 40
let fetchPromise: Promise<void> | null = null

interface ProjectStore {
  items: Project[]
  total: number
  status: AsyncStatus
  error: string | null
  selectedProjectId: string | null
  fetch: () => Promise<void>
  loadMore: () => Promise<void>
  select: (publicId: string | null) => void
  create: (input: Omit<Project, 'public_id' | 'archived_at' | 'summary'>) => Promise<Project>
  archive: (publicId: string) => Promise<void>
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  items: [], total: 0, status: 'idle', error: null, selectedProjectId: null,
  fetch: async () => {
    if (fetchPromise) return fetchPromise
    fetchPromise = (async () => {
      set({ status: 'running', error: null })
      try {
        const page = await window.api.project.list({ limit: PAGE_SIZE, offset: 0 })
        set({ items: page.items, total: page.total, status: 'success' })
      } catch (error) {
        set({ status: 'error', error: error instanceof Error ? error.message : 'Unable to load projects' })
      }
    })()
    try { await fetchPromise } finally { fetchPromise = null }
  },
  loadMore: async () => {
    const state = get()
    if (state.status === 'running' || state.items.length >= state.total) return
    set({ status: 'running', error: null })
    try {
      const page = await window.api.project.list({ limit: PAGE_SIZE, offset: state.items.length })
      const merged = mergePage(state.items, page.items, page.total)
      set({ ...merged, total: page.total, status: 'success' })
    } catch (error) {
      set({ status: 'error', error: error instanceof Error ? error.message : 'Unable to load projects' })
    }
  },
  select: (publicId) => set({ selectedProjectId: publicId }),
  create: async (input) => {
    const item = await window.api.project.create(input)
    set({ items: [item, ...get().items], total: get().total + 1, status: 'success' })
    return item
  },
  archive: async (publicId) => {
    await window.api.project.archive(publicId)
    set({
      items: get().items.filter((item) => item.public_id !== publicId),
      total: Math.max(0, get().total - 1),
      selectedProjectId: get().selectedProjectId === publicId ? null : get().selectedProjectId
    })
  }
}))

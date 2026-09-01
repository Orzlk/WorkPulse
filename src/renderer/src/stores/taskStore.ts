import { create } from 'zustand'
import type { WorkItemAssociations } from '../lib/workspaceTypes'

interface Task {
  id: number
  title: string
  description: string
  status: 'todo' | 'in_progress' | 'done' | 'draft'
  board_column: string
  position: number
  created_at: string
  updated_at: string
  completed_at: string | null
  due_date: string | null
  priority: 'low' | 'medium' | 'high'
  checklist: Array<{ id: string; text: string; completed: boolean }>
  public_id: string
  project_id: string | null
  tag_names: string[]
}

interface TaskStore {
  tasks: Task[]
  loading: boolean
  error: string | null
  lastDeleted: Task | null
  fetchTasks: () => Promise<void>
  loadByPublicId: (publicId: string) => Promise<Task | null>
  addTask: (title: string, description?: string, status?: 'todo' | 'draft', createdAt?: string, associations?: WorkItemAssociations, priority?: Task['priority'], dueDate?: string | null) => Promise<Task>
  updateTask: (id: number, updates: Partial<Pick<Task, 'title' | 'description' | 'status' | 'board_column' | 'position' | 'due_date' | 'priority' | 'checklist'>> & WorkItemAssociations) => Promise<void>
  deleteTask: (id: number) => Promise<void>
  undoDelete: () => Promise<void>
  dismissUndo: () => void
  completeTask: (id: number, logContent: string) => Promise<void>
  completeTaskOnly: (id: number) => Promise<void>
  reorderTasks: (taskIds: number[], boardColumn: string, status?: Task['status'], sourceBoardColumn?: string, sourceTaskIds?: number[], sourceStatus?: Task['status']) => Promise<void>
  getByStatus: (status: Task['status']) => Task[]
}

export const useTaskStore = create<TaskStore>((set, get) => ({
  tasks: [],
  loading: false,
  error: null,
  lastDeleted: null,

  fetchTasks: async () => {
    set({ loading: true })
    try {
      const tasks = await window.api.task.list()
      set({ tasks, error: null })
    } catch (error) {
      set({ error: error instanceof Error ? error.message : '加载任务失败' })
    } finally {
      set({ loading: false })
    }
  },

  loadByPublicId: async (publicId) => {
    const task = await window.api.task.get(publicId)
    if (!task) return null
    set((state) => ({ tasks: [...state.tasks.filter((item) => item.public_id !== task.public_id), task] }))
    return task
  },

  addTask: async (title, description, status, createdAt?, associations?, priority?, dueDate?) => {
    const task = await window.api.task.add(title, description, status, createdAt, associations, priority, dueDate)
    set({ tasks: [...get().tasks, task] })
    return task
  },

  updateTask: async (id, updates) => {
    const updated = await window.api.task.update(id, updates)
    if (updated) {
      set({ tasks: get().tasks.map((t) => (t.id === id ? updated : t)) })
    }
  },

  deleteTask: async (id) => {
    const deleted = get().tasks.find((task) => task.id === id) ?? null
    await window.api.task.delete(id)
    set({ tasks: get().tasks.filter((t) => t.id !== id), lastDeleted: deleted })
  },

  undoDelete: async () => {
    const deleted = get().lastDeleted
    if (!deleted) return
    const restored = await window.api.task.restore(deleted.id)
    if (restored) {
      set({ lastDeleted: null })
      await get().fetchTasks()
    }
  },

  dismissUndo: () => {
    set({ lastDeleted: null })
  },

  completeTask: async (id, logContent) => {
    const updated = await window.api.task.complete(id, logContent)
    if (updated) {
      set({ tasks: get().tasks.map((t) => (t.id === id ? updated : t)) })
    }
  },

  completeTaskOnly: async (id) => {
    const updated = await window.api.task.completeOnly(id)
    if (updated) {
      set({ tasks: get().tasks.map((t) => (t.id === id ? updated : t)) })
    }
  },

  reorderTasks: async (taskIds, boardColumn, status?, sourceBoardColumn?, sourceTaskIds?, sourceStatus?) => {
    await window.api.task.reorder(taskIds, boardColumn, status, sourceBoardColumn, sourceTaskIds, sourceStatus)
    // Refetch to get updated positions
    await get().fetchTasks()
  },

  getByStatus: (status) => {
    return get()
      .tasks.filter((t) => t.status === status)
      .sort((a, b) => a.position - b.position)
  }
}))

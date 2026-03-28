import { create } from 'zustand'
import type { ScheduledTask } from '../types/scheduled-task'

interface ScheduledTaskState {
  tasks: ScheduledTask[]
  mainView: 'chat' | 'task'
  activeView: 'list' | 'editor'
  editingTaskId: string | null

  fetchTasks: () => Promise<void>
  createTask: (data: Omit<ScheduledTask, 'id' | 'createdAt' | 'updatedAt'>) => Promise<ScheduledTask>
  updateTask: (id: string, updates: Partial<ScheduledTask>) => Promise<void>
  deleteTask: (id: string) => Promise<void>
  setEnabled: (id: string, enabled: boolean) => Promise<void>
  runNow: (id: string) => Promise<{ success: boolean; error?: string }>

  setMainView: (view: 'chat' | 'task') => void
  setActiveView: (view: 'list' | 'editor') => void
  setEditingTaskId: (id: string | null) => void
  openEditor: (taskId?: string) => void
  closeEditor: () => void
}

export const useScheduledTaskStore = create<ScheduledTaskState>((set, get) => ({
  tasks: [],
  mainView: 'chat',
  activeView: 'list',
  editingTaskId: null,

  fetchTasks: async () => {
    const tasks = await window.api.scheduledTask.list()
    set({ tasks })
  },

  createTask: async (data) => {
    const task = await window.api.scheduledTask.create(data as any)
    set((state) => ({ tasks: [...state.tasks, task] }))
    return task
  },

  updateTask: async (id, updates) => {
    await window.api.scheduledTask.update(id, updates as any)
    set((state) => ({
      tasks: state.tasks.map((t) => (t.id === id ? { ...t, ...updates, updatedAt: Date.now() } : t))
    }))
  },

  deleteTask: async (id) => {
    await window.api.scheduledTask.delete(id)
    set((state) => ({ tasks: state.tasks.filter((t) => t.id !== id) }))
  },

  setEnabled: async (id, enabled) => {
    const result = await window.api.scheduledTask.setEnabled(id, enabled)
    if (result) {
      set((state) => ({
        tasks: state.tasks.map((t) => (t.id === id ? { ...t, ...result } : t))
      }))
    }
  },

  runNow: async (id) => {
    return await window.api.scheduledTask.runNow(id)
  },

  setMainView: (view) => set({ mainView: view }),
  setActiveView: (view) => set({ activeView: view }),
  setEditingTaskId: (id) => set({ editingTaskId: id }),

  openEditor: (taskId) => {
    set({ activeView: 'editor', editingTaskId: taskId || null })
  },

  closeEditor: () => {
    set({ activeView: 'list', editingTaskId: null })
  }
}))

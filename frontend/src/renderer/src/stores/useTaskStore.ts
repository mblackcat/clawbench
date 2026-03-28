import { create } from 'zustand'
import type { TaskInfo, TaskStatus, SubAppOutput } from '../types/subapp'

export interface SystemLogEntry {
  level: string
  message: string
  timestamp: number
}

interface TaskState {
  tasks: Record<string, TaskInfo>
  activeTaskId: string | null
  systemLogs: SystemLogEntry[]
  startTask: (taskId: string, appId: string, appName: string) => void
  updateOutput: (taskId: string, output: SubAppOutput) => void
  updateProgress: (taskId: string, percent: number) => void
  updateStatus: (
    taskId: string,
    status: TaskStatus,
    result?: { success: boolean; summary: string }
  ) => void
  setActiveTask: (taskId: string | null) => void
  getTask: (taskId: string) => TaskInfo | undefined
  clearCompleted: () => void
  addSystemLog: (entry: SystemLogEntry) => void
  clearSystemLogs: () => void
}

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: {},
  activeTaskId: null,
  systemLogs: [],

  startTask: (taskId: string, appId: string, appName: string) => {
    const task: TaskInfo = {
      taskId,
      appId,
      appName,
      status: 'running',
      progress: 0,
      outputs: [],
      startedAt: Date.now()
    }
    set((state) => ({
      tasks: { ...state.tasks, [taskId]: task }
    }))
  },

  updateOutput: (taskId: string, output: SubAppOutput) => {
    set((state) => {
      const task = state.tasks[taskId]
      if (!task) return state
      return {
        tasks: {
          ...state.tasks,
          [taskId]: {
            ...task,
            outputs: [...task.outputs, output]
          }
        }
      }
    })
  },

  updateProgress: (taskId: string, percent: number) => {
    set((state) => {
      const task = state.tasks[taskId]
      if (!task) return state
      return {
        tasks: {
          ...state.tasks,
          [taskId]: { ...task, progress: percent }
        }
      }
    })
  },

  updateStatus: (
    taskId: string,
    status: TaskStatus,
    result?: { success: boolean; summary: string }
  ) => {
    set((state) => {
      const task = state.tasks[taskId]
      if (!task) return state
      return {
        tasks: {
          ...state.tasks,
          [taskId]: {
            ...task,
            status,
            result,
            completedAt:
              status === 'completed' || status === 'failed' || status === 'cancelled'
                ? Date.now()
                : task.completedAt
          }
        }
      }
    })
  },

  setActiveTask: (taskId: string | null) => {
    set({ activeTaskId: taskId })
  },

  getTask: (taskId: string) => {
    return get().tasks[taskId]
  },

  clearCompleted: () => {
    set((state) => {
      const tasks: Record<string, TaskInfo> = {}
      for (const [id, task] of Object.entries(state.tasks)) {
        if (task.status !== 'completed' && task.status !== 'failed' && task.status !== 'cancelled') {
          tasks[id] = task
        }
      }
      const activeTaskId =
        state.activeTaskId && tasks[state.activeTaskId] ? state.activeTaskId : null
      return { tasks, activeTaskId }
    })
  },

  addSystemLog: (entry: SystemLogEntry) => {
    set((state) => ({
      systemLogs: [...state.systemLogs.slice(-499), entry]
    }))
  },

  clearSystemLogs: () => {
    set({ systemLogs: [] })
  }
}))

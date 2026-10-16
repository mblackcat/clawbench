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
  /** True while there are task errors the user hasn't viewed in the app-log tab */
  hasUnseenErrors: boolean
  startTask: (taskId: string, appId: string, appName: string, opts?: StartTaskOptions) => void
  updateOutput: (taskId: string, output: SubAppOutput) => void
  updateProgress: (taskId: string, percent: number) => void
  updateStatus: (
    taskId: string,
    status: TaskStatus,
    result?: { success: boolean; summary: string; summaryI18nKey?: string; summaryI18nArgs?: string[] }
  ) => void
  setActiveTask: (taskId: string | null) => void
  getTask: (taskId: string) => TaskInfo | undefined
  clearCompleted: () => void
  addSystemLog: (entry: SystemLogEntry) => void
  clearSystemLogs: () => void
  markErrorsSeen: () => void
}

export interface StartTaskOptions {
  scheduled?: boolean
  /** Create the task already in a terminal state (e.g. disabled before process start). */
  status?: TaskStatus
  result?: { success: boolean; summary: string; summaryI18nKey?: string; summaryI18nArgs?: string[] }
  initialOutput?: SubAppOutput
}

export function isTerminalTaskStatus(status: TaskStatus): boolean {
  return (
    status === 'completed' || status === 'failed' || status === 'cancelled' || status === 'disabled'
  )
}

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: {},
  activeTaskId: null,
  systemLogs: [],
  hasUnseenErrors: false,

  startTask: (taskId: string, appId: string, appName: string, opts?: StartTaskOptions) => {
    // Idempotent: never reset an existing task (early failure / dual callers
    // must not wipe logs that were already written).
    set((state) => {
      if (state.tasks[taskId]) return state
      const status = opts?.status ?? 'running'
      const task: TaskInfo = {
        taskId,
        appId,
        appName,
        status,
        progress: 0,
        outputs: opts?.initialOutput ? [opts.initialOutput] : [],
        startedAt: Date.now(),
        completedAt: isTerminalTaskStatus(status) ? Date.now() : undefined,
        result: opts?.result,
        scheduled: opts?.scheduled
      }
      const isError =
        status === 'failed' || status === 'disabled' || opts?.initialOutput?.type === 'error'
      return {
        tasks: { ...state.tasks, [taskId]: task },
        hasUnseenErrors: isError ? true : state.hasUnseenErrors
      }
    })
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
        },
        hasUnseenErrors: output.type === 'error' ? true : state.hasUnseenErrors
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
    result?: { success: boolean; summary: string; summaryI18nKey?: string; summaryI18nArgs?: string[] }
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
              isTerminalTaskStatus(status)
                ? Date.now()
                : task.completedAt
          }
        },
        hasUnseenErrors:
          status === 'failed' || status === 'disabled' ? true : state.hasUnseenErrors
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
        if (!isTerminalTaskStatus(task.status)) {
          tasks[id] = task
        }
      }
      const activeTaskId =
        state.activeTaskId && tasks[state.activeTaskId] ? state.activeTaskId : null
      return { tasks, activeTaskId, hasUnseenErrors: false }
    })
  },

  addSystemLog: (entry: SystemLogEntry) => {
    set((state) => ({
      systemLogs: [...state.systemLogs.slice(-499), entry]
    }))
  },

  clearSystemLogs: () => {
    set({ systemLogs: [] })
  },

  markErrorsSeen: () => {
    set({ hasUnseenErrors: false })
  }
}))

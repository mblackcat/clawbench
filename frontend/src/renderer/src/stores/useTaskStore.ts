import { create } from 'zustand'
import type { TaskInfo, TaskStatus, SubAppOutput } from '../types/subapp'

/** How long the transient error alert (avatar ring pulse) stays visible. */
export const ERROR_ALERT_DURATION_MS = 6000
let errorAlertTimer: ReturnType<typeof setTimeout> | null = null

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
  startTask: (taskId: string, appId: string, appName: string, opts?: { scheduled?: boolean }) => void
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

  // ---- Transient error alert (avatar ring) + unread system logs ----
  /** True for ERROR_ALERT_DURATION_MS after the latest task error */
  hasErrorAlert: boolean
  /** Summary of the latest error (tooltip text); null when none */
  errorAlertSummary: string | null
  /** True when system logs arrived since the log panel was last viewed */
  hasUnreadLogs: boolean
  triggerErrorAlert: (summary?: string) => void
  dismissErrorAlert: () => void
  markLogsRead: () => void
}

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: {},
  activeTaskId: null,
  systemLogs: [],
  hasUnseenErrors: false,
  hasErrorAlert: false,
  errorAlertSummary: null,
  hasUnreadLogs: false,

  startTask: (taskId: string, appId: string, appName: string, opts?: { scheduled?: boolean }) => {
    const task: TaskInfo = {
      taskId,
      appId,
      appName,
      status: 'running',
      progress: 0,
      outputs: [],
      startedAt: Date.now(),
      scheduled: opts?.scheduled
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
        },
        hasUnseenErrors: output.type === 'error' ? true : state.hasUnseenErrors
      }
    })
    if (output.type === 'error' && get().tasks[taskId]) {
      get().triggerErrorAlert(output.message)
    }
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
              status === 'completed' || status === 'failed' || status === 'cancelled'
                ? Date.now()
                : task.completedAt
          }
        },
        hasUnseenErrors: status === 'failed' ? true : state.hasUnseenErrors
      }
    })
    if (status === 'failed' && get().tasks[taskId]) {
      get().triggerErrorAlert(result?.summary)
    }
  },

  setActiveTask: (taskId: string | null) => {
    set({ activeTaskId: taskId })
  },

  getTask: (taskId: string) => {
    return get().tasks[taskId]
  },

  clearCompleted: () => {
    get().dismissErrorAlert()
    set((state) => {
      const tasks: Record<string, TaskInfo> = {}
      for (const [id, task] of Object.entries(state.tasks)) {
        if (task.status !== 'completed' && task.status !== 'failed' && task.status !== 'cancelled') {
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
      systemLogs: [...state.systemLogs.slice(-499), entry],
      hasUnreadLogs: true
    }))
  },

  clearSystemLogs: () => {
    set({ systemLogs: [], hasUnreadLogs: false })
  },

  markErrorsSeen: () => {
    set({ hasUnseenErrors: false })
  },

  // ---- Transient error alert (avatar ring) + unread system logs ----
  triggerErrorAlert: (summary?: string) => {
    if (errorAlertTimer) {
      clearTimeout(errorAlertTimer)
      errorAlertTimer = null
    }
    set({
      hasErrorAlert: true,
      errorAlertSummary: summary || get().errorAlertSummary || null
    })
    errorAlertTimer = setTimeout(() => {
      errorAlertTimer = null
      set({ hasErrorAlert: false, errorAlertSummary: null })
    }, ERROR_ALERT_DURATION_MS)
  },

  dismissErrorAlert: () => {
    if (errorAlertTimer) {
      clearTimeout(errorAlertTimer)
      errorAlertTimer = null
    }
    set({ hasErrorAlert: false, errorAlertSummary: null })
  },

  markLogsRead: () => {
    set({ hasUnreadLogs: false })
  }
}))

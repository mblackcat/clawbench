import { useEffect, useCallback } from 'react'
import { useTaskStore } from '../stores/useTaskStore'
import { useSubAppStore } from '../stores/useSubAppStore'
import { raiseWorkbenchCompletion } from '../stores/useAttentionStore'
import type { SubAppOutput, TaskStatus } from '../types/subapp'

interface UseSubAppExecutionReturn {
  executeApp: (appId: string, params?: Record<string, unknown>) => Promise<string>
  cancelTask: (taskId: string) => Promise<void>
}

export function useSubAppExecution(): UseSubAppExecutionReturn {
  const startTask = useTaskStore((state) => state.startTask)
  const updateOutput = useTaskStore((state) => state.updateOutput)
  const updateProgress = useTaskStore((state) => state.updateProgress)
  const updateStatus = useTaskStore((state) => state.updateStatus)
  const setActiveTask = useTaskStore((state) => state.setActiveTask)
  const getTask = useTaskStore((state) => state.getTask)
  const apps = useSubAppStore((state) => state.apps)

  // Set up IPC event listeners for subapp output, progress, and task status
  useEffect(() => {
    const unsubOutput = window.api.subapp.onOutput((data: SubAppOutput) => {
      updateOutput(data.taskId, data)
    })

    const unsubProgress = window.api.subapp.onProgress((data: SubAppOutput) => {
      if (data.percent !== undefined) {
        updateProgress(data.taskId, data.percent)
      }
    })

    const unsubStatus = window.api.subapp.onTaskStatus(
      (data: {
        taskId: string
        status: string
        success?: boolean
        summary?: string
        summaryI18nKey?: string
        summaryI18nArgs?: string[]
      }) => {
        const status = data.status as TaskStatus
        const result =
          data.summary !== undefined
            ? {
                success: data.success ?? status === 'completed',
                summary: data.summary,
                summaryI18nKey: data.summaryI18nKey,
                summaryI18nArgs: data.summaryI18nArgs
              }
            : undefined
        updateStatus(data.taskId, status, result)

        // Background success → red-dot attention when user is not on workbench
        if (status === 'completed' && (data.success ?? true)) {
          const task = useTaskStore.getState().tasks[data.taskId]
          const appName = task?.appName || '应用'
          raiseWorkbenchCompletion(data.taskId, appName)
        }
      }
    )

    // Listen for tasks started via global shortcuts or the scheduler (from main process)
    const unsubStarted = window.api.subapp.onTaskStarted(
      (data: { taskId: string; appId: string; appName: string; scheduled?: boolean }) => {
        const scheduled = !!data.scheduled
        startTask(data.taskId, data.appId, data.appName, { scheduled })
        // For background scheduled runs, don't steal focus from a currently-running
        // interactive task — only surface the panel when the user is idle.
        if (scheduled) {
          const state = useTaskStore.getState()
          const active = state.activeTaskId ? state.tasks[state.activeTaskId] : undefined
          if (!active || active.status !== 'running') {
            setActiveTask(data.taskId)
          }
        } else {
          setActiveTask(data.taskId)
        }
      }
    )

    return () => {
      unsubOutput()
      unsubProgress()
      unsubStatus()
      unsubStarted()
    }
  }, [updateOutput, updateProgress, updateStatus, startTask, setActiveTask])

  const executeApp = useCallback(
    async (appId: string, params?: Record<string, unknown>): Promise<string> => {
      const taskId = await window.api.subapp.execute(appId, params)
      const app = apps.find((a) => a.id === appId)
      const appName = app?.name ?? appId
      if (!getTask(taskId)) {
        startTask(taskId, appId, appName)
      }
      setActiveTask(taskId)
      return taskId
    },
    [apps, getTask, startTask, setActiveTask]
  )

  const cancelTask = useCallback(async (taskId: string): Promise<void> => {
    await window.api.subapp.cancel(taskId)
  }, [])

  return { executeApp, cancelTask }
}

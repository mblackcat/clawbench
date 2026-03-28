import { useEffect, useCallback } from 'react'
import { useTaskStore } from '../stores/useTaskStore'
import { useSubAppStore } from '../stores/useSubAppStore'
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
      (data: { taskId: string; status: string; success?: boolean; summary?: string }) => {
        const status = data.status as TaskStatus
        const result =
          data.success !== undefined && data.summary !== undefined
            ? { success: data.success, summary: data.summary }
            : undefined
        updateStatus(data.taskId, status, result)
      }
    )

    // Listen for tasks started via global shortcuts (from main process)
    const unsubStarted = window.api.subapp.onTaskStarted(
      (data: { taskId: string; appId: string; appName: string }) => {
        startTask(data.taskId, data.appId, data.appName)
        setActiveTask(data.taskId)
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
      startTask(taskId, appId, appName)
      setActiveTask(taskId)
      return taskId
    },
    [apps, startTask, setActiveTask]
  )

  const cancelTask = useCallback(async (taskId: string): Promise<void> => {
    await window.api.subapp.cancel(taskId)
  }, [])

  return { executeApp, cancelTask }
}

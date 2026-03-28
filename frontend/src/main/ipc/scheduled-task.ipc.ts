import { ipcMain } from 'electron'
import {
  listScheduledTasks,
  getScheduledTask,
  createScheduledTask,
  updateScheduledTask,
  deleteScheduledTask,
  setScheduledTaskEnabled
} from '../store/scheduled-task.store'
import { executeTask, computeNextRun } from '../services/scheduled-task.service'
import { getIMBridgeService } from '../services/im/im-bridge.service'
import * as logger from '../utils/logger'

export function registerScheduledTaskIpc(): void {
  ipcMain.handle('scheduled-task:list', () => {
    return listScheduledTasks()
  })

  ipcMain.handle('scheduled-task:get', (_event, id: string) => {
    return getScheduledTask(id)
  })

  ipcMain.handle('scheduled-task:create', (_event, data: any) => {
    const task = createScheduledTask(data)
    // Compute initial nextRunAt
    const nextRun = computeNextRun(task)
    if (nextRun) {
      updateScheduledTask(task.id, { nextRunAt: nextRun })
      task.nextRunAt = nextRun
    }
    return task
  })

  ipcMain.handle('scheduled-task:update', (_event, id: string, updates: any) => {
    const updated = updateScheduledTask(id, updates)
    if (updated && (updates.time || updates.repeatRule || updates.dayOfWeek || updates.dayOfMonth)) {
      const nextRun = computeNextRun(updated)
      if (nextRun) {
        updateScheduledTask(id, { nextRunAt: nextRun })
      }
    }
    return updated
  })

  ipcMain.handle('scheduled-task:delete', (_event, id: string) => {
    return deleteScheduledTask(id)
  })

  ipcMain.handle('scheduled-task:set-enabled', (_event, id: string, enabled: boolean) => {
    const task = setScheduledTaskEnabled(id, enabled)
    if (task && enabled) {
      const nextRun = computeNextRun(task)
      if (nextRun) {
        updateScheduledTask(id, { nextRunAt: nextRun })
      }
    }
    return task
  })

  ipcMain.handle('scheduled-task:run-now', async (_event, id: string) => {
    const task = getScheduledTask(id)
    if (!task) throw new Error('Task not found')
    try {
      await executeTask(task)
      return { success: true }
    } catch (err: any) {
      logger.error('[ScheduledTask IPC] run-now failed:', err)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('scheduled-task:im-status', () => {
    try {
      const bridge = getIMBridgeService()
      const status = bridge.getConnectionStatus()
      return { connected: status.state === 'connected' }
    } catch {
      return { connected: false }
    }
  })
}

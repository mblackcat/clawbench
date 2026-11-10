import { ipcMain, shell } from 'electron'
import { remoteTaskService } from '../services/remote-task.service'
import { getRemoteTaskLogDir } from '../services/remote-task-logger'
import {
  getRemoteTaskMode,
  setRemoteTaskMode,
  REMOTE_TASK_MODES,
  type RemoteTaskMode
} from '../store/settings.store'

/** Thin IPC wrappers for remote task dispatch (see remote-task.service). */
export function registerRemoteTaskIpc(): void {
  ipcMain.handle('remoteTask:listWaiting', () => remoteTaskService.listWaiting())

  ipcMain.handle('remoteTask:confirm', (_event, taskId: unknown, params: unknown) => {
    if (typeof taskId !== 'string') return { success: false }
    return { success: remoteTaskService.confirm(taskId, params) }
  })

  ipcMain.handle('remoteTask:reject', (_event, taskId: unknown) => {
    if (typeof taskId !== 'string') return { success: false }
    return { success: remoteTaskService.reject(taskId) }
  })

  ipcMain.handle('remoteTask:openLogDir', async () => {
    const dir = getRemoteTaskLogDir()
    await shell.openPath(dir)
    return { success: true, dir }
  })

  ipcMain.handle('remoteTask:pull', async () => {
    await remoteTaskService.pull()
    return { success: true }
  })

  ipcMain.handle('remoteTask:getMode', () => getRemoteTaskMode())

  ipcMain.handle('remoteTask:setMode', (_event, mode: unknown) => {
    if (!REMOTE_TASK_MODES.includes(mode as RemoteTaskMode)) return { success: false }
    setRemoteTaskMode(mode as RemoteTaskMode)
    return { success: true }
  })
}

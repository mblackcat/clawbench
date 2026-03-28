import { ipcMain } from 'electron'
import { manualCheckForUpdates, quitAndInstall } from '../services/updater.service'
import * as logger from '../utils/logger'

export function registerUpdaterIpc(): void {
  ipcMain.handle('updater:check', async () => {
    try {
      await manualCheckForUpdates()
      return { success: true }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Check failed'
      logger.error('updater:check error:', message)
      return { success: false, error: message }
    }
  })

  ipcMain.handle('updater:install', () => {
    quitAndInstall()
  })
}

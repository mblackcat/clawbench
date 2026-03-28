import { ipcMain } from 'electron'
import { detectAll, detectOne, installTool } from '../services/local-env.service'

export function registerLocalEnvIpc(): void {
  ipcMain.handle('local-env:detect-all', async () => {
    return detectAll()
  })

  ipcMain.handle('local-env:detect-one', async (_event, toolId: string) => {
    return detectOne(toolId)
  })

  ipcMain.handle('local-env:install', async (_event, toolId: string) => {
    return installTool(toolId)
  })
}

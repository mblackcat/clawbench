import { ipcMain } from 'electron'
import { getFeishuToolsService, isFeishuToolsAvailable } from '../services/feishu-tools.service'

export function registerFeishuToolsIpc(): void {
  ipcMain.handle('feishu-tools:list', async () => {
    return getFeishuToolsService().listTools()
  })

  ipcMain.handle('feishu-tools:execute', async (_event, toolName: string, input: Record<string, any>) => {
    return getFeishuToolsService().executeTool(toolName, input)
  })

  ipcMain.handle('feishu-tools:check-availability', () => {
    return isFeishuToolsAvailable()
  })
}

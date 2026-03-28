import { ipcMain } from 'electron'
import { internalToolRegistry, initInternalTools } from '../services/internal-tools.service'

export function registerInternalToolsIpc(): void {
  // Initialize providers on registration
  initInternalTools()

  ipcMain.handle('internal-tools:list', async () => {
    return internalToolRegistry.listAllTools()
  })

  ipcMain.handle('internal-tools:execute', async (_event, toolName: string, input: Record<string, any>) => {
    return internalToolRegistry.executeTool(toolName, input)
  })
}

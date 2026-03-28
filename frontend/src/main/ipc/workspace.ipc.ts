import { ipcMain } from 'electron'
import {
  listWorkspaces,
  createWorkspace,
  updateWorkspace,
  deleteWorkspace,
  setActiveWorkspace,
  getActiveWorkspace
} from '../services/workspace.service'

export function registerWorkspaceIpc(): void {
  ipcMain.handle('workspace:list', async () => {
    return listWorkspaces()
  })

  ipcMain.handle('workspace:create', async (_event, name: string, path: string, vcsType?: string) => {
    const result = createWorkspace(name, path, vcsType)
    if (!result.success) throw new Error(result.error)
    return result.workspace
  })

  ipcMain.handle(
    'workspace:update',
    async (_event, id: string, updates: Record<string, unknown>) => {
      const result = updateWorkspace(id, updates)
      if (!result.success) throw new Error(result.error)
      return result.workspace
    }
  )

  ipcMain.handle('workspace:delete', async (_event, id: string) => {
    const result = deleteWorkspace(id)
    if (!result.success) throw new Error(result.error)
  })

  ipcMain.handle('workspace:set-active', async (_event, id: string) => {
    const result = setActiveWorkspace(id)
    if (!result.success) throw new Error(result.error)
  })

  ipcMain.handle('workspace:get-active', async () => {
    return getActiveWorkspace()
  })
}

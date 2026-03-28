import { ipcMain } from 'electron'
import { getAuthStatus, startLogin, logout } from '../services/auth.service'

export function registerAuthIpc(): void {
  ipcMain.handle('auth:get-status', async () => {
    return getAuthStatus()
  })

  ipcMain.handle('auth:start-login', async (event) => {
    const webContents = event.sender
    return startLogin(webContents)
  })

  ipcMain.handle('auth:logout', async (event) => {
    const webContents = event.sender
    return logout(webContents)
  })
}

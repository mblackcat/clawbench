import { ipcMain } from 'electron'
import {
  getAuthStatus,
  startLogin,
  cancelLogin,
  logout,
  getFeishuAuthUrl,
  openAuthModalWindow
} from '../services/auth.service'

export function registerAuthIpc(): void {
  ipcMain.handle('auth:get-status', async () => {
    return getAuthStatus()
  })

  ipcMain.handle('auth:start-login', async (event) => {
    const webContents = event.sender
    return startLogin(webContents)
  })

  ipcMain.handle('auth:cancel-login', async () => {
    cancelLogin()
  })

  ipcMain.handle('auth:get-auth-url', () => {
    return getFeishuAuthUrl()
  })

  ipcMain.handle('auth:open-modal-login', (event) => {
    openAuthModalWindow(getFeishuAuthUrl(), event.sender)
  })

  ipcMain.handle('auth:logout', async (event) => {
    const webContents = event.sender
    return logout(webContents)
  })
}

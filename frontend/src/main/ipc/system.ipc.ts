import { ipcMain } from 'electron'
import { getLocalIpv4 } from '../services/system.service'

export function registerSystemIpc(): void {
  ipcMain.handle('system:get-local-ip', () => {
    return getLocalIpv4()
  })
}

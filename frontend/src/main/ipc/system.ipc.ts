import { ipcMain } from 'electron'
import { getLocalIpv4 } from '../services/system.service'
import { takePendingOpenApp } from '../services/protocol/commands/open-app.command'

export function registerSystemIpc(): void {
  ipcMain.handle('system:get-local-ip', () => {
    return getLocalIpv4()
  })

  // Share link / landing page launch: the renderer pulls the stored
  // open-app request once it is mounted (cold start may miss the event).
  ipcMain.handle('protocol:take-pending-open-app', () => {
    return takePendingOpenApp()
  })
}

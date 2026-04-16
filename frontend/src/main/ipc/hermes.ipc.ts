import { ipcMain } from 'electron'
import {
  checkInstalled,
  installHermes,
  uninstallHermes,
  getServiceStatus,
  startGateway,
  stopGateway,
  getConfig,
  saveConfig,
  upgradeHermes
} from '../services/hermes.service'
import type { HermesConfig } from '../services/hermes.service'

export function registerHermesIpc(): void {
  ipcMain.handle('hermes:check-installed', async () => checkInstalled())
  ipcMain.handle('hermes:install', async () => installHermes())
  ipcMain.handle('hermes:uninstall', async () => uninstallHermes())
  ipcMain.handle('hermes:get-status', async () => getServiceStatus())
  ipcMain.handle('hermes:start', async () => startGateway())
  ipcMain.handle('hermes:stop', async () => stopGateway())
  ipcMain.handle('hermes:get-config', async () => getConfig())
  ipcMain.handle('hermes:save-config', async (_event, config: HermesConfig) => saveConfig(config))
  ipcMain.handle('hermes:upgrade', async () => upgradeHermes())
}

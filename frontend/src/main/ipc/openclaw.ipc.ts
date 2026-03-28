import { ipcMain } from 'electron'
import {
  checkInstalled,
  installOpenClaw,
  uninstallOpenClaw,
  getServiceStatus,
  startService,
  stopService,
  getConfig,
  saveConfig,
  applyConfig,
  listCommunitySkills,
  installSkill,
  getCronJobs,
  toggleCronJob,
  checkLatestVersion,
  pairingApprove,
  getGatewayDashboardUrl,
  startGoogleOAuth
} from '../services/openclaw.service'
import { startLogWatcher, stopLogWatcher } from '../services/openclaw-log-watcher.service'

export function registerOpenClawIpc(): void {
  ipcMain.handle('openclaw:check-installed', async () => {
    return checkInstalled()
  })

  ipcMain.handle('openclaw:install', async () => {
    return installOpenClaw()
  })

  ipcMain.handle('openclaw:uninstall', async (_event, removeConfig: boolean) => {
    return uninstallOpenClaw(removeConfig)
  })

  ipcMain.handle('openclaw:get-status', async () => {
    return getServiceStatus()
  })

  ipcMain.handle('openclaw:start', async () => {
    return startService()
  })

  ipcMain.handle('openclaw:stop', async () => {
    return stopService()
  })

  ipcMain.handle('openclaw:get-config', async () => {
    return getConfig()
  })

  ipcMain.handle('openclaw:save-config', async (_event, config) => {
    return saveConfig(config)
  })

  ipcMain.handle('openclaw:apply-config', async (_event, config) => {
    return applyConfig(config)
  })

  ipcMain.handle('openclaw:list-community-skills', async () => {
    return listCommunitySkills()
  })

  ipcMain.handle('openclaw:install-skill', async (_event, id: string) => {
    return installSkill(id)
  })

  ipcMain.handle('openclaw:get-cron-jobs', async () => {
    return getCronJobs()
  })

  ipcMain.handle('openclaw:toggle-cron-job', async (_event, id: string, enabled: boolean) => {
    return toggleCronJob(id, enabled)
  })

  ipcMain.handle('openclaw:check-latest-version', async () => {
    return checkLatestVersion()
  })

  ipcMain.handle('openclaw:pairing-approve', async (_event, channel: string, code: string) => {
    return pairingApprove(channel, code)
  })

  ipcMain.handle('openclaw:get-gateway-url', async () => {
    return getGatewayDashboardUrl()
  })

  ipcMain.handle('openclaw:start-google-oauth', async () => {
    return startGoogleOAuth()
  })

  ipcMain.handle('openclaw:start-log-watcher', async (event) => {
    startLogWatcher(event.sender)
  })

  ipcMain.handle('openclaw:stop-log-watcher', async () => {
    stopLogWatcher()
  })
}

import { ipcMain, BrowserWindow } from 'electron'
import fs from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { listSubApps, getManifest, getSubAppPath, uninstallApp, installApp } from '../services/subapp.service'
import { executeSubApp, cancelTask } from '../services/python-runner.service'
import { getActiveWorkspace } from '../services/workspace.service'
import { settingsStore } from '../store/settings.store'
import { getPythonSdkPath, getTempDir } from '../utils/paths'
import { unzipArchive } from '../utils/zip'
import * as logger from '../utils/logger'

export function registerSubAppIpc(): void {
  ipcMain.handle('subapp:list', async () => {
    return listSubApps()
  })

  ipcMain.handle('subapp:get-manifest', async (_event, appId: string) => {
    return getManifest(appId)
  })

  ipcMain.handle(
    'subapp:execute',
    async (event, appId: string, params?: Record<string, unknown>) => {
      const taskId = randomUUID()
      const manifest = getManifest(appId)
      if (!manifest) {
        throw new Error(`Sub-app not found: ${appId}`)
      }

      const appPath = getSubAppPath(appId)
      if (!appPath) {
        throw new Error(`Sub-app path not found: ${appId}`)
      }

      const workspace = getActiveWorkspace()
      if (!workspace) {
        throw new Error('No active workspace selected')
      }

      const pythonPath = (settingsStore.get('pythonPath') as string) || 'python3'
      const sdkPath = getPythonSdkPath()
      const webContents = event.sender
      const window = BrowserWindow.fromWebContents(webContents)

      if (!window) {
        throw new Error('Cannot find browser window')
      }

      executeSubApp(
        taskId,
        manifest.name,
        appPath,
        manifest.entry,
        params || {},
        workspace,
        pythonPath,
        sdkPath,
        webContents
      )

      return taskId
    }
  )

  ipcMain.handle('subapp:cancel', async (_event, taskId: string) => {
    cancelTask(taskId)
  })

  ipcMain.handle('subapp:uninstall', async (_event, appId: string) => {
    return uninstallApp(appId)
  })

  /**
   * Download and install an app from the marketplace.
   * Runs entirely in the main process: download zip → extract → installApp.
   */
  ipcMain.handle(
    'subapp:install-from-market',
    async (_event, appId: string, downloadUrl: string, token?: string) => {
      logger.info(`[Marketplace] Installing app from market: ${appId}`)

      const headers: Record<string, string> = {}
      if (token) {
        headers['Authorization'] = `Bearer ${token}`
      }

      const resp = await fetch(downloadUrl, { headers })
      if (!resp.ok) {
        throw new Error(`下载失败: HTTP ${resp.status}`)
      }

      const buffer = await resp.arrayBuffer()
      const tmpDir = getTempDir()
      if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true })

      const safeId = appId.replace(/[^a-zA-Z0-9._-]/g, '_')
      const zipPath = join(tmpDir, `market-${safeId}.zip`)
      fs.writeFileSync(zipPath, Buffer.from(buffer))

      const extractDir = join(tmpDir, `market-extract-${Date.now()}`)
      fs.mkdirSync(extractDir, { recursive: true })

      unzipArchive(zipPath, extractDir)

      // Find the app directory (may be nested one level)
      let appSourceDir = extractDir
      const entries = fs.readdirSync(extractDir, { withFileTypes: true })
      const subDirs = entries.filter((e) => e.isDirectory())
      if (subDirs.length === 1 && !fs.existsSync(join(extractDir, 'manifest.json'))) {
        appSourceDir = join(extractDir, subDirs[0].name)
      }

      const result = installApp(appSourceDir)

      // Cleanup temp files
      try {
        fs.rmSync(zipPath, { force: true })
        fs.rmSync(extractDir, { recursive: true, force: true })
      } catch { /* ignore cleanup errors */ }

      if (!result.success) {
        throw new Error(result.error || '安装失败')
      }

      logger.info(`[Marketplace] Installed: ${result.manifest?.name} (${appId})`)
      return { success: true, manifest: result.manifest }
    }
  )
}

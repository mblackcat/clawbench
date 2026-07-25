import { ipcMain, BrowserWindow } from 'electron'
import fs from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { listSubApps, getManifest, getSubAppPath, uninstallApp, installApp } from '../services/subapp.service'
import {
  executeSubApp,
  cancelTask,
  resolvePythonCommand,
  getI18nPayload,
  sendUiEventToSubApp
} from '../services/python-runner.service'
import { resolveSubAppSlot } from '../services/subapp-slot.service'
import { getActiveWorkspace } from '../services/workspace.service'
import {
  AppDisabledError,
  BUILTIN_APP_ID_PREFIX,
  enrichBuiltinAppParams
} from '../services/project.service'
import { installSkill, InstallMode, SkillTool } from '../services/skill-install.service'
import { getPythonSdkPath, getTempDir } from '../utils/paths'
import { unzipArchive } from '../utils/zip'
import { recordDownloadEvent } from '../services/usage-tracking.service'
import * as logger from '../utils/logger'

/**
 * Shared helper: download a marketplace package, unzip it, and locate the
 * directory containing manifest.json. Returns the source dir and a cleanup
 * callback that removes the temp zip + extract dir.
 */
async function downloadAndExtractMarketPackage(
  appId: string,
  downloadUrl: string,
  token: string | undefined,
  filePrefix: string
): Promise<{ sourceDir: string; cleanup: () => void }> {
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
  const zipPath = join(tmpDir, `${filePrefix}-${safeId}.zip`)
  fs.writeFileSync(zipPath, Buffer.from(buffer))

  const extractDir = join(tmpDir, `${filePrefix}-extract-${Date.now()}`)
  fs.mkdirSync(extractDir, { recursive: true })

  unzipArchive(zipPath, extractDir)

  // Find the app directory (may be nested one level)
  let sourceDir = extractDir
  const entries = fs.readdirSync(extractDir, { withFileTypes: true })
  const subDirs = entries.filter((e) => e.isDirectory())
  if (subDirs.length === 1 && !fs.existsSync(join(extractDir, 'manifest.json'))) {
    sourceDir = join(extractDir, subDirs[0].name)
  }

  return {
    sourceDir,
    cleanup: () => {
      try {
        fs.rmSync(zipPath, { force: true })
        fs.rmSync(extractDir, { recursive: true, force: true })
      } catch { /* ignore cleanup errors */ }
    }
  }
}

export function registerSubAppIpc(): void {
  ipcMain.handle('subapp:list', async () => {
    return listSubApps()
  })

  ipcMain.handle('subapp:get-manifest', async (_event, appId: string) => {
    return getManifest(appId)
  })

  ipcMain.handle(
    'subapp:resolve-slot',
    async (
      _event,
      appId: string,
      slot: string,
      params: Record<string, unknown> = {}
    ) => {
      const manifest = getManifest(appId)
      const appPath = getSubAppPath(appId)
      if (!manifest || !appPath) {
        throw new Error(`Sub-app not found: ${appId}`)
      }

      const normalizedSlot = slot.trim()
      if (!normalizedSlot) {
        throw new Error('Slot name is required')
      }

      const workspace = getActiveWorkspace()
      if (!workspace) {
        throw new Error('No active workspace selected')
      }

      const python = await resolvePythonCommand()
      return resolveSubAppSlot({
        appPath,
        entryFile: manifest.entry,
        slot: normalizedSlot,
        params,
        workspace,
        pythonPath: python.path,
        sdkPath: getPythonSdkPath(),
        timeoutMs: 30_000
      })
    }
  )

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

      const sdkPath = getPythonSdkPath()
      const webContents = event.sender
      const window = BrowserWindow.fromWebContents(webContents)

      if (!window) {
        throw new Error('Cannot find browser window')
      }

      // Builtin enable gate (admin kill-switch) + config injection before
      // announcing the task, so disabled apps surface immediately with the
      // disabled reason rather than flashing as "running". Surfaced via the
      // existing task-started/task-status channels (status 'failed' carries
      // the disabled i18n message) so no renderer contract change is needed.
      let effectiveParams: Record<string, unknown> = params || {}
      if (appId.startsWith(BUILTIN_APP_ID_PREFIX)) {
        try {
          effectiveParams = await enrichBuiltinAppParams(appId, manifest.name, effectiveParams)
        } catch (err) {
          const isDisabled = err instanceof AppDisabledError
          const message = err instanceof Error ? err.message : String(err)
          webContents.send('subapp:task-started', {
            taskId,
            appId,
            appName: manifest.name
          })
          webContents.send('subapp:task-status', {
            taskId,
            status: 'failed',
            success: false,
            summary: message,
            summaryI18nKey: isDisabled ? err.i18nKey : undefined,
            summaryI18nArgs: isDisabled ? err.i18nArgs : undefined
          })
          return taskId
        }
      }

      webContents.send('subapp:task-started', {
        taskId,
        appId,
        appName: manifest.name
      })

      let pythonPath: string
      try {
        const python = await resolvePythonCommand()
        pythonPath = python.path
        logger.info(
          `Using ${python.source} Python for sub-app ${appId}: ${python.path} (${python.version})`
        )
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        const i18nPayload = getI18nPayload(err)
        logger.error(`Failed to resolve Python for sub-app ${appId}:`, message)
        webContents.send('subapp:output', {
          taskId,
          type: 'error',
          message,
          ...i18nPayload
        })
        webContents.send('subapp:task-status', {
          taskId,
          status: 'failed',
          summary: message,
          summaryI18nKey: i18nPayload.i18nKey,
          summaryI18nArgs: i18nPayload.i18nArgs
        })
        return taskId
      }

      executeSubApp(
        taskId,
        appId,
        manifest.name,
        manifest.version,
        appPath,
        manifest.entry,
        effectiveParams,
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

  ipcMain.handle('subapp:ui-event', async (_event, taskId: string, uiEvent: Record<string, unknown>) => {
    return sendUiEventToSubApp(taskId, uiEvent)
  })

  ipcMain.handle('subapp:uninstall', async (_event, appId: string) => {
    return uninstallApp(appId)
  })

  /**
   * Download and install an app from the marketplace.
   * Runs entirely in the main process: download zip → extract → installApp.
   * Destructive: wipes the existing target dir before copying.
   */
  ipcMain.handle(
    'subapp:install-from-market',
    async (_event, appId: string, downloadUrl: string, token?: string) => {
      logger.info(`[Marketplace] Installing app from market: ${appId}`)

      const { sourceDir, cleanup } = await downloadAndExtractMarketPackage(
        appId,
        downloadUrl,
        token,
        'market'
      )

      const result = installApp(sourceDir)
      cleanup()

      if (!result.success) {
        throw new Error(result.error || '安装失败')
      }

      logger.info(`[Marketplace] Installed: ${result.manifest?.name} (${appId})`)
      recordDownloadEvent(appId, result.manifest?.version)
      return { success: true, manifest: result.manifest }
    }
  )

  /**
   * Download and update an app from the marketplace.
   * Non-destructive merge: new files overwrite same-named old files, but
   * locally-generated files (data/, output/, logs, user edits) are preserved.
   */
  ipcMain.handle(
    'subapp:update-from-market',
    async (
      _event,
      appId: string,
      downloadUrl: string,
      token?: string,
      opts?: { force?: boolean }
    ) => {
      const force = !!opts?.force
      logger.info(`[Marketplace] ${force ? 'Resetting' : 'Updating'} app from market: ${appId}`)

      const { sourceDir, cleanup } = await downloadAndExtractMarketPackage(
        appId,
        downloadUrl,
        token,
        force ? 'market-reset' : 'market-update'
      )

      // force=true: full replace (reset to online). Otherwise merge so local data survives.
      const result = installApp(sourceDir, { preserveLocal: !force })
      cleanup()

      if (!result.success) {
        throw new Error(result.error || (force ? '重置失败' : '更新失败'))
      }

      logger.info(`[Marketplace] ${force ? 'Reset' : 'Updated'}: ${result.manifest?.name} (${appId})`)
      recordDownloadEvent(appId, result.manifest?.version)
      return { success: true, manifest: result.manifest }
    }
  )

  /**
   * Download an AI-skill from the marketplace and place it using one of the
   * four install modes. Mirrors install-from-market but routes through the
   * unified skill installer instead of copying into user-apps unconditionally.
   */
  ipcMain.handle(
    'subapp:install-skill-from-market',
    async (
      _event,
      appId: string,
      downloadUrl: string,
      opts: {
        mode: InstallMode
        tools: SkillTool[]
        workspacePath?: string
      },
      token?: string
    ) => {
      logger.info(`[Marketplace] Installing skill from market: ${appId} (${opts.mode})`)

      const headers: Record<string, string> = {}
      if (token) headers['Authorization'] = `Bearer ${token}`

      const resp = await fetch(downloadUrl, { headers })
      if (!resp.ok) {
        throw new Error(`下载失败: HTTP ${resp.status}`)
      }

      const buffer = await resp.arrayBuffer()
      const tmpDir = getTempDir()
      if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true })

      const safeId = appId.replace(/[^a-zA-Z0-9._-]/g, '_')
      const zipPath = join(tmpDir, `market-skill-${safeId}.zip`)
      fs.writeFileSync(zipPath, Buffer.from(buffer))

      const extractDir = join(tmpDir, `market-skill-extract-${Date.now()}`)
      fs.mkdirSync(extractDir, { recursive: true })
      unzipArchive(zipPath, extractDir)

      // Resolve the directory containing manifest.json / SKILL.md.
      let sourceDir = extractDir
      const subDirs = fs
        .readdirSync(extractDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
      if (
        subDirs.length === 1 &&
        !fs.existsSync(join(extractDir, 'manifest.json')) &&
        !fs.existsSync(join(extractDir, 'SKILL.md'))
      ) {
        sourceDir = join(extractDir, subDirs[0].name)
      }

      const result = installSkill({
        sourceDir,
        mode: opts.mode,
        tools: opts.tools,
        workspacePath: opts.workspacePath,
        skillId: appId
      })

      try {
        fs.rmSync(zipPath, { force: true })
        fs.rmSync(extractDir, { recursive: true, force: true })
      } catch {
        /* ignore cleanup errors */
      }

      if (!result.success) {
        throw new Error(result.error || '安装失败')
      }

      logger.info(`[Marketplace] Skill installed: ${appId} -> ${result.installedTo.join(', ')}`)
      return { success: true, installedTo: result.installedTo }
    }
  )
}

import { ipcMain, BrowserWindow } from 'electron'
import fs from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { listSubApps, getManifest, getSubAppPath, uninstallApp, installApp } from '../services/subapp.service'
import { resetBuiltinApp, getBundledBuiltinVersion } from '../services/builtin-apps.service'
import {
  executeSubApp,
  cancelTask,
  resolvePythonCommand,
  sendUiEventToSubApp
} from '../services/python-runner.service'
import { gateSubAppRun, prepareSubAppPython } from '../services/subapp-run.service'
import { resolveSubAppSlot } from '../services/subapp-slot.service'
import { getActiveWorkspace } from '../services/workspace.service'
import { installSkill, InstallMode, SkillTool } from '../services/skill-install.service'
import { getPythonSdkPath, getTempDir } from '../utils/paths'
import { unzipArchive } from '../utils/zip'
import { recordDownloadEvent } from '../services/usage-tracking.service'
import { installAppRequirements } from '../services/python-venv.service'
import { fetchPackageArchive } from '../utils/download-guard'
import * as logger from '../utils/logger'
import { mainT } from '../utils/i18n'

/** App ids whose `subapp:execute` is still preparing (gate / Python / requirements). */
const preparingApps = new Set<string>()

/**
 * Best-effort requirements install for a freshly installed app (sha256-cached;
 * targets the interpreter the app will run with).
 */
async function ensureAppRequirements(appId: string, installedAppPath?: string): Promise<void> {
  const appPath = installedAppPath || getSubAppPath(appId)
  if (!appPath) return
  try {
    await installAppRequirements(appPath)
  } catch (reqErr) {
    logger.warn(`Failed to install requirements for ${appId}:`, reqErr)
  }
}

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
  // Validated URL, 30s timeout, 100MB cap
  const buffer = await fetchPackageArchive(downloadUrl, token)
  const tmpDir = getTempDir()
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true })

  const safeId = appId.replace(/[^a-zA-Z0-9._-]/g, '_')
  const zipPath = join(tmpDir, `${filePrefix}-${safeId}.zip`)
  fs.writeFileSync(zipPath, buffer)

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

export interface SubAppExecuteResult {
  taskId: string
  /** Set when the run ended before the process started (disabled / no Python / gate error). */
  earlyTerminal?: {
    status: 'failed' | 'disabled'
    summary: string
    summaryI18nKey?: string
    summaryI18nArgs?: string[]
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

      const python = await resolvePythonCommand(appPath)
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
    async (event, appId: string, params?: Record<string, unknown>): Promise<SubAppExecuteResult> => {
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

      /**
       * Early terminal result returned via the invoke response only (no
       * task-started / task-status events). The renderer seeds the bottom log
       * panel + toast from `earlyTerminal`, so disabled apps never flash as
       * "running".
       */
      const finishEarly = (
        status: 'failed' | 'disabled',
        message: string,
        i18nKey?: string,
        i18nArgs?: string[]
      ): SubAppExecuteResult => ({
        taskId,
        earlyTerminal: {
          status,
          summary: message,
          summaryI18nKey: i18nKey,
          summaryI18nArgs: i18nArgs
        }
      })

      // Refuse a second concurrent start of the same app while it is still
      // preparing (venv creation / pip install can take a while).
      if (preparingApps.has(appId)) {
        return finishEarly(
          'failed',
          mainT('subapp.alreadyStarting', manifest.name),
          'subapp.alreadyStarting',
          [manifest.name]
        )
      }
      preparingApps.add(appId)

      const target = { appId, appName: manifest.name, appPath }
      let released = false
      const release = (): void => {
        if (released) return
        released = true
        preparingApps.delete(appId)
      }

      // Builtin kill-switch gate + config/user injection. Runs before
      // task-started so disabled apps never flash as "running".
      let gate: Awaited<ReturnType<typeof gateSubAppRun>>
      try {
        gate = await gateSubAppRun(target, params)
      } catch (err) {
        release()
        throw err
      }
      if (!gate.ok) {
        release()
        return finishEarly(gate.status, gate.message, gate.i18nKey, gate.i18nArgs)
      }
      const effectiveParams = gate.params

      webContents.send('subapp:task-started', {
        taskId,
        appId,
        appName: manifest.name
      })

      // Python resolution + requirements run after task-started; progress is
      // streamed as task output and failures end the task via task-status.
      const send = (channel: string, payload: Record<string, unknown>): void => {
        if (!webContents.isDestroyed()) webContents.send(channel, payload)
      }
      setImmediate(() => {
        void (async () => {
          try {
            const py = await prepareSubAppPython(target, (message, level) =>
              send('subapp:output', { taskId, type: 'output', level, message, timestamp: Date.now() })
            )
            if (!py.ok) {
              send('subapp:output', {
                taskId,
                type: 'error',
                level: 'error',
                message: py.message,
                i18nKey: py.i18nKey,
                i18nArgs: py.i18nArgs
              })
              send('subapp:task-status', {
                taskId,
                status: 'failed',
                success: false,
                summary: py.message,
                summaryI18nKey: py.i18nKey,
                summaryI18nArgs: py.i18nArgs
              })
              return
            }
            if (webContents.isDestroyed()) return
            executeSubApp(
              taskId,
              appId,
              manifest.name,
              manifest.version,
              appPath,
              manifest.entry,
              effectiveParams,
              workspace,
              py.python.path,
              sdkPath,
              webContents
            )
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            logger.error(`Failed to start sub-app ${appId}:`, message)
            send('subapp:task-status', { taskId, status: 'failed', success: false, summary: message })
          } finally {
            release()
          }
        })()
      })

      const result: SubAppExecuteResult = { taskId }
      return result
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

      const result = installApp(sourceDir, { expectedId: appId })
      cleanup()

      if (!result.success) {
        throw new Error(result.error || '安装失败')
      }

      await ensureAppRequirements(appId, result.targetDir)

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
      const result = installApp(sourceDir, { preserveLocal: !force, expectedId: appId })
      cleanup()

      if (!result.success) {
        throw new Error(result.error || (force ? '重置失败' : '更新失败'))
      }

      await ensureAppRequirements(appId, result.targetDir)

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

      const buffer = await fetchPackageArchive(downloadUrl, token)
      const tmpDir = getTempDir()
      if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true })

      const safeId = appId.replace(/[^a-zA-Z0-9._-]/g, '_')
      const zipPath = join(tmpDir, `market-skill-${safeId}.zip`)
      fs.writeFileSync(zipPath, buffer)

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

  ipcMain.handle('subapp:reset-builtin', async (_event, appId: string) => {
    return resetBuiltinApp(appId)
  })

  ipcMain.handle('subapp:get-bundled-builtin-version', async (_event, appId: string) => {
    return getBundledBuiltinVersion(appId)
  })

  ipcMain.handle('subapp:install-requirements', async (_event, appId: string, force?: boolean) => {
    const appPath = getSubAppPath(appId)
    if (!appPath) {
      return { success: false, error: `App not found: ${appId}` }
    }
    return installAppRequirements(appPath, { force: Boolean(force) })
  })
}

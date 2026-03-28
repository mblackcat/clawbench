import { ipcMain } from 'electron'
import fs from 'fs'
import { join, dirname } from 'path'
import os from 'os'
import { execSync, spawn } from 'child_process'
import { zipDirectory } from '../utils/zip'
import {
  createAppScaffold,
  updateApp,
  publishApp,
  discoverSharedApps
} from '../services/publisher.service'
import { listSubApps } from '../services/subapp.service'
import { settingsStore } from '../store/settings.store'
import { getUserAppsPath } from '../utils/paths'
import * as logger from '../utils/logger'

// ── IDE auto-detect ──────────────────────────────────────────────────────────

function detectLocalIde(): string | null {
  const platform = process.platform
  const home = os.homedir()

  const vscodePaths =
    platform === 'darwin'
      ? [
          '/usr/local/bin/code',
          '/usr/bin/code',
          `${home}/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code`,
          '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code'
        ]
      : platform === 'win32'
        ? [
            `${process.env.LOCALAPPDATA}\\Programs\\Microsoft VS Code\\Code.exe`,
            `${process.env.ProgramFiles}\\Microsoft VS Code\\Code.exe`
          ]
        : ['/usr/bin/code', '/usr/local/bin/code']

  for (const p of vscodePaths) {
    if (p && fs.existsSync(p)) return p
  }

  const pycharmPaths =
    platform === 'darwin'
      ? [
          '/usr/local/bin/pycharm',
          `${home}/Applications/PyCharm CE.app/Contents/MacOS/pycharm CE`,
          `${home}/Applications/PyCharm.app/Contents/MacOS/pycharm`,
          '/Applications/PyCharm CE.app/Contents/MacOS/pycharm CE',
          '/Applications/PyCharm.app/Contents/MacOS/pycharm'
        ]
      : platform === 'win32'
        ? []
        : ['/usr/local/bin/pycharm', '/usr/bin/pycharm']

  for (const p of pycharmPaths) {
    if (p && fs.existsSync(p)) return p
  }

  return null
}

// ── Terminal auto-detect ──────────────────────────────────────────────────────

function detectLocalTerminal(): string | null {
  const platform = process.platform
  const home = os.homedir()

  if (platform === 'darwin') {
    const candidates = [
      `${home}/Applications/iTerm.app`,
      '/Applications/iTerm.app',
      `${home}/Applications/Warp.app`,
      '/Applications/Warp.app',
      `${home}/Applications/Alacritty.app`,
      '/Applications/Alacritty.app'
    ]
    for (const p of candidates) {
      if (fs.existsSync(p)) return p
    }
  }

  return null
}

export function registerDeveloperIpc(): void {
  ipcMain.handle('developer:create-app', async (_event, appInfo: Record<string, unknown>) => {
    const result = createAppScaffold(appInfo)
    if (!result.success) throw new Error(result.error)
    return result.path
  })

  ipcMain.handle(
    'developer:update-app',
    async (_event, appId: string, updates: Record<string, unknown>) => {
      const result = updateApp(appId, updates)
      if (!result.success) throw new Error(result.error)
      return true
    }
  )

  ipcMain.handle('developer:delete-app', async (_event, appId: string) => {
    try {
      const userAppsDir = getUserAppsPath()
      const appDir = join(userAppsDir, appId)

      logger.info(`Attempting to delete app: ${appId} at ${appDir}`)

      if (!fs.existsSync(appDir)) {
        const error = `App directory not found: ${appDir}`
        logger.error(error)
        throw new Error(error)
      }

      fs.rmSync(appDir, { recursive: true, force: true })
      logger.info(`Successfully deleted app: ${appId}`)
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error('Failed to delete app:', message)
      throw err
    }
  })

  ipcMain.handle('developer:get-app-path', async (_event, appId: string) => {
    const userAppsDir = getUserAppsPath()
    return join(userAppsDir, appId)
  })

  ipcMain.handle('developer:list-app-files', async (_event, appId: string) => {
    const userAppsDir = getUserAppsPath()
    const appDir = join(userAppsDir, appId)

    if (!fs.existsSync(appDir)) {
      throw new Error(`App directory not found: ${appDir}`)
    }

    const files: Array<{ name: string; path: string; isDirectory: boolean }> = []
    const entries = fs.readdirSync(appDir, { withFileTypes: true })

    for (const entry of entries) {
      files.push({
        name: entry.name,
        path: join(appDir, entry.name),
        isDirectory: entry.isDirectory()
      })
    }

    return files
  })

  ipcMain.handle('developer:read-file', async (_event, filePath: string) => {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`)
    }
    return fs.readFileSync(filePath, 'utf-8')
  })

  ipcMain.handle('developer:write-file', async (_event, filePath: string, content: string) => {
    fs.writeFileSync(filePath, content, 'utf-8')
    return true
  })

  // ── File tree operations ───────────────────────────────────────────────────

  ipcMain.handle('developer:create-file', async (_event, filePath: string) => {
    const dir = dirname(filePath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(filePath, '', 'utf-8')
    return true
  })

  ipcMain.handle('developer:create-folder', async (_event, folderPath: string) => {
    fs.mkdirSync(folderPath, { recursive: true })
    return true
  })

  ipcMain.handle('developer:rename-file', async (_event, oldPath: string, newPath: string) => {
    if (!fs.existsSync(oldPath)) {
      throw new Error(`Path not found: ${oldPath}`)
    }
    if (fs.existsSync(newPath)) {
      throw new Error(`Target already exists: ${newPath}`)
    }
    fs.renameSync(oldPath, newPath)
    return true
  })

  ipcMain.handle('developer:delete-file', async (_event, filePath: string) => {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Path not found: ${filePath}`)
    }
    const stat = fs.statSync(filePath)
    if (stat.isDirectory()) {
      fs.rmSync(filePath, { recursive: true, force: true })
    } else {
      fs.unlinkSync(filePath)
    }
    return true
  })

  ipcMain.handle('developer:move-file', async (_event, oldPath: string, newPath: string) => {
    if (!fs.existsSync(oldPath)) {
      throw new Error(`Path not found: ${oldPath}`)
    }
    if (fs.existsSync(newPath)) {
      throw new Error(`Target already exists: ${newPath}`)
    }
    fs.renameSync(oldPath, newPath)
    return true
  })

  // ── IDE operations ─────────────────────────────────────────────────────────

  ipcMain.handle('developer:detect-ide', async () => {
    return detectLocalIde()
  })

  ipcMain.handle('developer:detect-terminal', async () => {
    return detectLocalTerminal()
  })

  ipcMain.handle('developer:open-in-ide', async (_event, appPath: string) => {
    const configuredPath = (settingsStore.get('localIdePath') as string) || ''
    const idePath = configuredPath || detectLocalIde()

    if (!idePath) {
      throw new Error('未找到本地 IDE，请在「设置 → 通用」中配置 IDE 路径')
    }

    if (!fs.existsSync(appPath)) {
      throw new Error(`应用目录不存在: ${appPath}`)
    }

    if (process.platform === 'darwin' && idePath.endsWith('.app')) {
      spawn('open', ['-a', idePath, appPath], { detached: true, stdio: 'ignore' }).unref()
    } else {
      spawn(idePath, [appPath], { detached: true, stdio: 'ignore' }).unref()
    }
    return true
  })

  ipcMain.handle('developer:open-ssh-config', async () => {
    const sshConfigPath = join(os.homedir(), '.ssh', 'config')
    if (!fs.existsSync(sshConfigPath)) {
      throw new Error(`SSH config not found: ${sshConfigPath}`)
    }

    const configuredPath = (settingsStore.get('localIdePath') as string) || ''
    const idePath = configuredPath || detectLocalIde()

    if (idePath) {
      if (process.platform === 'darwin' && idePath.endsWith('.app')) {
        spawn('open', ['-a', idePath, sshConfigPath], { detached: true, stdio: 'ignore' }).unref()
      } else {
        spawn(idePath, [sshConfigPath], { detached: true, stdio: 'ignore' }).unref()
      }
    } else {
      const { shell } = await import('electron')
      await shell.openPath(sshConfigPath)
    }
    return true
  })

  ipcMain.handle('developer:open-file-in-editor', async (_event, filePath: string) => {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`)
    }

    const configuredPath = (settingsStore.get('localIdePath') as string) || ''
    const idePath = configuredPath || detectLocalIde()

    if (idePath) {
      if (process.platform === 'darwin' && idePath.endsWith('.app')) {
        spawn('open', ['-a', idePath, filePath], { detached: true, stdio: 'ignore' }).unref()
      } else {
        spawn(idePath, [filePath], { detached: true, stdio: 'ignore' }).unref()
      }
    } else {
      // Fallback to system default text editor
      const { shell } = await import('electron')
      await shell.openPath(filePath)
    }
    return true
  })

  ipcMain.handle('developer:publish-app', async (_event, appId: string) => {
    logger.info('Preparing app for publish:', appId)

    try {
      const userAppsDir = getUserAppsPath()
      const appPath = join(userAppsDir, appId)

      if (!fs.existsSync(appPath)) {
        throw new Error(`App path does not exist: ${appPath}`)
      }

      const manifestPath = join(appPath, 'manifest.json')
      if (!fs.existsSync(manifestPath)) {
        throw new Error('No manifest.json found in app directory')
      }

      const manifestContent = fs.readFileSync(manifestPath, 'utf-8')
      const manifest = JSON.parse(manifestContent)

      logger.info('App ready for publish:', manifest.id)

      return {
        success: true,
        appId: manifest.id,
        appPath: appPath,
        manifest: manifest
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error('Failed to prepare app for publish:', message)
      throw new Error(message)
    }
  })

  ipcMain.handle('developer:package-app', async (_event, appId: string) => {
    logger.info('Packaging app:', appId)

    try {
      const userAppsDir = getUserAppsPath()
      const appPath = join(userAppsDir, appId)

      if (!fs.existsSync(appPath)) {
        throw new Error(`App path does not exist: ${appPath}`)
      }

      const manifestPath = join(appPath, 'manifest.json')
      if (!fs.existsSync(manifestPath)) {
        throw new Error('No manifest.json found in app directory')
      }

      const manifestContent = fs.readFileSync(manifestPath, 'utf-8')
      const manifest = JSON.parse(manifestContent)

      const tmpDir = join(os.tmpdir(), 'clawbench-publish')
      if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true })
      }
      const zipFileName = `${manifest.id}-${manifest.version}.zip`
      const zipPath = join(tmpDir, zipFileName)

      if (fs.existsSync(zipPath)) {
        fs.unlinkSync(zipPath)
      }

      zipDirectory(appPath, zipPath)

      const buffer = fs.readFileSync(zipPath)
      fs.unlinkSync(zipPath)

      logger.info(`App packaged: ${zipFileName}, size: ${buffer.length} bytes`)

      return {
        buffer: buffer,
        fileName: zipFileName,
        fileSize: buffer.length
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error('Failed to package app:', message)
      throw new Error(message)
    }
  })

  ipcMain.handle('developer:list-my-apps', async () => {
    const allApps = listSubApps()
    return allApps
      .filter((app) => !app.manifest.id.startsWith('com.clawbench.'))
      .map((app) => app.manifest)
  })

  ipcMain.handle('developer:discover-shared', async () => {
    const userAppDir = (settingsStore.get('userAppDir') as string) || getUserAppsPath()
    if (!userAppDir) return []
    return discoverSharedApps(userAppDir)
  })

  ipcMain.handle('developer:open-app-directory', async (_event, appPath: string) => {
    try {
      const { shell } = await import('electron')
      if (!fs.existsSync(appPath)) {
        throw new Error(`Directory not found: ${appPath}`)
      }
      await shell.openPath(appPath)
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error('Failed to open app directory:', message)
      throw err
    }
  })
}

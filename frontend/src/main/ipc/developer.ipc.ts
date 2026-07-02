import { ipcMain } from 'electron'
import fs from 'fs'
import { join, dirname, resolve, relative, isAbsolute, sep } from 'path'
import os from 'os'
import { execSync, spawn } from 'child_process'
import { zipDirectory } from '../utils/zip'
import {
  createAppScaffold,
  updateApp,
  publishApp,
  discoverSharedApps
} from '../services/publisher.service'
import type { AppInfo } from '../services/publisher.service'
import { listSubApps } from '../services/subapp.service'
import { readSkillMeta } from '../services/skill-install.service'
import { settingsStore } from '../store/settings.store'
import { getAllWorkspaces } from '../store/workspace.store'
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
  // ── .clawbenchignore support ──────────────────────────────────────────────

  /**
   * Read ignore rules from a directory. Supports both `.clawbenchignore` and
   * `.ignore` files. Format: one glob per line (same as .gitignore). Lines
   * starting with '#' are comments; blank lines are ignored.
   */
  const readIgnorePatterns = (dir: string): string[] => {
    const candidateNames = ['.clawbenchignore', '.ignore']
    let content: string | null = null

    for (const name of candidateNames) {
      const ignorePath = join(dir, name)
      if (fs.existsSync(ignorePath)) {
        try {
          content = fs.readFileSync(ignorePath, 'utf-8')
          break
        } catch {
          // try next candidate
        }
      }
    }

    if (!content) return []

    return content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'))
  }

  /**
   * Check whether a relative path matches any glob pattern.
   * Simple implementation supporting * wildcards (single-segment) and
   * ** (multi-segment). Also supports leading / for root-anchored patterns.
   */
  const matchesPattern = (relPath: string, pattern: string): boolean => {
    // Strip leading / for matching (patterns like /node_modules)
    const p = pattern.replace(/^\//, '')

    // Build regex from glob pattern
    const regexStr = p
      .replace(/[.+^${}()|[\]\\]/g, '\\$&') // escape regex specials
      .replace(/\*\*(?=$|\/)/g, '__DEEP__')   // preserve ** followed by / or end
      .replace(/\*\*/g, '.*')                   // ** matches anything including /
      .replace(/__DEEP__/g, '.*')               // restore preserved (already replaced)
      .replace(/\*/g, '[^/]*')                  // * matches within a single segment
      .replace(/\?/g, '[^/]')                   // ? matches a single non-/ char

    // Pattern without slash matches anywhere in the path
    // Pattern with slash is matched against the full relative path
    if (p.includes('/')) {
      return new RegExp(`^${regexStr}$`).test(relPath)
    } else {
      // Match at any depth
      return new RegExp(`(^|/)${regexStr}($|/)`).test(relPath)
    }
  }

  /**
   * Check if a relative path should be excluded by any ignore pattern.
   */
  const isIgnored = (relPath: string, patterns: string[]): boolean => {
    for (const pattern of patterns) {
      if (matchesPattern(relPath, pattern)) return true
    }
    return false
  }

  /**
   * Recursively copy a directory tree, skipping files/dirs matched by ignore patterns.
   */
  const copyFiltered = (src: string, dest: string, ignorePatterns: string[], appRoot?: string): void => {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true })
    }

    const root = appRoot || src
    const entries = fs.readdirSync(src, { withFileTypes: true })
    for (const entry of entries) {
      const srcPath = join(src, entry.name)
      const destPath = join(dest, entry.name)

      // Compute path relative to the app root for pattern matching
      const relPath = relative(root, srcPath).replace(/\\/g, '/') + (entry.isDirectory() ? '/' : '')

      if (isIgnored(relPath, ignorePatterns)) {
        logger.info(`Skipping ignored: ${relPath}`)
        continue
      }

      if (entry.isDirectory()) {
        copyFiltered(srcPath, destPath, ignorePatterns, root)
      } else {
        fs.copyFileSync(srcPath, destPath)
      }
    }
  }

  // ── Path-traversal guard ─────────────────────────────────────────────────
  // The file-tree handlers below receive absolute paths straight from the
  // renderer. Every legitimate path is derived from `getAppPath(appId)`, i.e.
  // it lives under userData/user-apps. Reject anything that resolves outside
  // that root so a malicious/buggy caller cannot read or clobber arbitrary
  // files on disk (e.g. ~/.ssh, system config).
  const assertWithinAppRoots = (p: string): string => {
    if (typeof p !== 'string' || p.length === 0) {
      throw new Error('Invalid path')
    }
    const root = resolve(getUserAppsPath())
    const resolved = resolve(p)
    const rel = relative(root, resolved)
    // Inside the root when the relative path neither escapes upward (`..`)
    // nor is itself absolute (different drive on Windows).
    if (rel !== '' && (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel))) {
      throw new Error(`Path is outside the allowed app directory: ${p}`)
    }
    return resolved
  }

  ipcMain.handle('developer:create-app', async (_event, appInfo: AppInfo) => {
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
    assertWithinAppRoots(filePath)
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`)
    }
    return fs.readFileSync(filePath, 'utf-8')
  })

  ipcMain.handle('developer:write-file', async (_event, filePath: string, content: string) => {
    assertWithinAppRoots(filePath)
    try {
      // Ensure the parent directory exists (AI-generated files may live in
      // nested subdirectories that haven't been created yet).
      const dir = dirname(filePath)
      if (dir && !fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      fs.writeFileSync(filePath, content, 'utf-8')
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error(`Failed to write file ${filePath}:`, message)
      throw new Error(`写入文件失败 (${filePath}): ${message}`)
    }
  })

  // ── File tree operations ───────────────────────────────────────────────────

  ipcMain.handle('developer:create-file', async (_event, filePath: string) => {
    assertWithinAppRoots(filePath)
    const dir = dirname(filePath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(filePath, '', 'utf-8')
    return true
  })

  ipcMain.handle('developer:create-folder', async (_event, folderPath: string) => {
    assertWithinAppRoots(folderPath)
    fs.mkdirSync(folderPath, { recursive: true })
    return true
  })

  ipcMain.handle('developer:rename-file', async (_event, oldPath: string, newPath: string) => {
    assertWithinAppRoots(oldPath)
    assertWithinAppRoots(newPath)
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
    assertWithinAppRoots(filePath)
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
    assertWithinAppRoots(oldPath)
    assertWithinAppRoots(newPath)
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

      const ignorePatterns = readIgnorePatterns(appPath)

      const tmpDir = join(os.tmpdir(), 'clawbench-publish')
      if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true })
      }
      const zipFileName = `${manifest.id}-${manifest.version}.zip`
      const zipPath = join(tmpDir, zipFileName)

      if (fs.existsSync(zipPath)) {
        fs.unlinkSync(zipPath)
      }

      if (ignorePatterns.length === 0) {
        // Fast path: no ignore rules, zip directly
        zipDirectory(appPath, zipPath)
      } else {
        // Copy to staging directory, skipping ignored files
        const stageDir = join(tmpDir, `stage-${Date.now()}`)
        try {
          // Recursive copy with ignore filter
          copyFiltered(appPath, stageDir, ignorePatterns)
          zipDirectory(stageDir, zipPath)
        } finally {
          try {
            fs.rmSync(stageDir, { recursive: true, force: true })
          } catch { /* ignore cleanup errors */ }
        }
      }

      const buffer = fs.readFileSync(zipPath)
      fs.unlinkSync(zipPath)

      const excludedCount = ignorePatterns.length > 0 ? ` (${ignorePatterns.length} ignore patterns)` : ''
      logger.info(`App packaged: ${zipFileName}, size: ${buffer.length} bytes${excludedCount}`)

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

  ipcMain.handle('developer:package-dir', async (_event, sourceDir: string) => {
    logger.info('Packaging skill directory:', sourceDir)

    try {
      if (!fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) {
        throw new Error(`Directory does not exist: ${sourceDir}`)
      }
      if (!fs.existsSync(join(sourceDir, 'SKILL.md'))) {
        throw new Error('No SKILL.md found in directory')
      }

      const meta = readSkillMeta(sourceDir)
      const id = meta.manifestId || `skill.${meta.name}`

      // Package from a staging copy so we can guarantee a manifest without
      // mutating the user's original (possibly read-only) source folder.
      const tmpDir = join(os.tmpdir(), 'clawbench-publish')
      fs.mkdirSync(tmpDir, { recursive: true })
      const stageDir = join(tmpDir, `stage-${Date.now()}`)
      fs.cpSync(sourceDir, stageDir, { recursive: true, dereference: true })

      let manifest: Record<string, unknown>
      const manifestPath = join(stageDir, 'manifest.json')
      if (fs.existsSync(manifestPath)) {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
      } else {
        manifest = {
          id,
          name: meta.displayName,
          version: meta.version,
          description: meta.description,
          type: 'ai-skill',
          entry: 'SKILL.md'
        }
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8')
      }

      const zipFileName = `${manifest.id}-${manifest.version}.zip`
      const zipPath = join(tmpDir, zipFileName)
      if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath)

      zipDirectory(stageDir, zipPath)
      const buffer = fs.readFileSync(zipPath)

      try {
        fs.unlinkSync(zipPath)
        fs.rmSync(stageDir, { recursive: true, force: true })
      } catch {
        /* ignore cleanup errors */
      }

      logger.info(`Skill dir packaged: ${zipFileName}, size: ${buffer.length} bytes`)
      return { buffer, fileName: zipFileName, fileSize: buffer.length, manifest }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error('Failed to package skill directory:', message)
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

  // ── Path-based file operations (relaxed guard for workspace skills) ──────────
  // These handlers accept absolute paths that may point outside the user-apps
  // directory — used by SkillDetailView to browse workspace skill directories.
  // The guard still restricts access to known-safe locations: user-apps root,
  // registered workspace directories, and AI-tool config dirs (~/.claude etc.).

  const assertWithinKnownRoots = (p: string): string => {
    if (typeof p !== 'string' || p.length === 0) {
      throw new Error('Invalid path')
    }
    const resolved = resolve(p)

    // 1) User-apps directory
    const appsRoot = resolve(getUserAppsPath())
    const relApp = relative(appsRoot, resolved)
    if (relApp !== '' && !relApp.startsWith(`..${sep}`) && !isAbsolute(relApp)) {
      return resolved
    }

    // 2) Registered workspace directories
    const workspaces = getAllWorkspaces()
    for (const ws of workspaces) {
      if (!ws.path) continue
      const wsRoot = resolve(String(ws.path))
      const rel = relative(wsRoot, resolved)
      if (rel !== '' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)) {
        return resolved
      }
    }

    // 3) Home-directory AI tool config dirs (~/.claude, ~/.codex, ~/.gemini)
    const home = os.homedir()
    const aiDirs = ['.claude', '.codex', '.gemini'].map((d) => resolve(home, d))
    for (const dir of aiDirs) {
      const rel = relative(dir, resolved)
      if (rel !== '' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)) {
        return resolved
      }
    }

    throw new Error(`Path is outside allowed directories: ${p}`)
  }

  ipcMain.handle('developer:list-dir', async (_event, dirPath: string) => {
    assertWithinKnownRoots(dirPath)

    // Resolve symlinks / junctions to get the real path on disk.
    // fs.readdirSync on the symlink itself usually works, but on Windows
    // junctions can behave inconsistently, so we resolve first.
    let effectivePath: string
    try {
      effectivePath = fs.realpathSync(dirPath)
    } catch {
      throw new Error(
        `Cannot resolve path (broken symlink or missing directory): ${dirPath}`
      )
    }

    // If the resolved target lives outside known roots, fall back to the
    // original symlink path (the guard already approved it).
    try {
      assertWithinKnownRoots(effectivePath)
    } catch {
      logger.warn(
        `list-dir: resolved path outside known roots, using original: ${effectivePath} → ${dirPath}`
      )
      effectivePath = dirPath
    }

    if (!fs.statSync(effectivePath).isDirectory()) {
      throw new Error(`Not a directory: ${dirPath}`)
    }

    const files: Array<{ name: string; path: string; isDirectory: boolean }> = []
    const entries = fs.readdirSync(effectivePath, { withFileTypes: true })
    for (const entry of entries) {
      files.push({
        name: entry.name,
        path: join(effectivePath, entry.name),
        isDirectory: entry.isDirectory()
      })
    }
    return files
  })

  ipcMain.handle('developer:read-path-file', async (_event, filePath: string) => {
    assertWithinKnownRoots(filePath)
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`)
    }
    return fs.readFileSync(filePath, 'utf-8')
  })

  ipcMain.handle('developer:write-path-file', async (_event, filePath: string, content: string) => {
    assertWithinKnownRoots(filePath)
    const dir = dirname(filePath)
    if (dir && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(filePath, content, 'utf-8')
    return true
  })

  ipcMain.handle('developer:create-path-file', async (_event, filePath: string) => {
    assertWithinKnownRoots(filePath)
    const dir = dirname(filePath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(filePath, '', 'utf-8')
    return true
  })

  ipcMain.handle('developer:create-path-dir', async (_event, dirPath: string) => {
    assertWithinKnownRoots(dirPath)
    fs.mkdirSync(dirPath, { recursive: true })
    return true
  })

  ipcMain.handle('developer:rename-path', async (_event, oldPath: string, newPath: string) => {
    assertWithinKnownRoots(oldPath)
    assertWithinKnownRoots(newPath)
    if (!fs.existsSync(oldPath)) {
      throw new Error(`Path not found: ${oldPath}`)
    }
    if (fs.existsSync(newPath)) {
      throw new Error(`Target already exists: ${newPath}`)
    }
    fs.renameSync(oldPath, newPath)
    return true
  })

  ipcMain.handle('developer:delete-path', async (_event, filePath: string) => {
    assertWithinKnownRoots(filePath)
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

  ipcMain.handle('developer:move-path', async (_event, oldPath: string, newPath: string) => {
    assertWithinKnownRoots(oldPath)
    assertWithinKnownRoots(newPath)
    if (!fs.existsSync(oldPath)) {
      throw new Error(`Path not found: ${oldPath}`)
    }
    if (fs.existsSync(newPath)) {
      throw new Error(`Target already exists: ${newPath}`)
    }
    fs.renameSync(oldPath, newPath)
    return true
  })
}

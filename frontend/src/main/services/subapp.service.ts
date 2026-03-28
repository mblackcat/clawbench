import fs from 'fs'
import { join, basename } from 'path'
import { getUserAppsPath } from '../utils/paths'
import * as logger from '../utils/logger'

export interface SubAppManifest {
  id: string
  name: string
  version: string
  description: string
  entry: string
  icon?: string
  type?: 'app' | 'ai-skill' | 'prompt'
  author?: string | { name: string; email?: string; feishu_id?: string }
  category?: string
  published?: boolean
  [key: string]: unknown
}

export interface SubAppInfo {
  id: string
  manifest: SubAppManifest
  path: string
  source: 'user'
}

/**
 * Scans a directory for sub-apps. Each sub-directory should contain a manifest.json.
 */
function scanAppsDir(dir: string): SubAppInfo[] {
  const apps: SubAppInfo[] = []

  if (!fs.existsSync(dir)) {
    logger.debug(`Apps directory does not exist: ${dir}`)
    return apps
  }

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue

      const appDir = join(dir, entry.name)
      const manifestPath = join(appDir, 'manifest.json')

      if (!fs.existsSync(manifestPath)) {
        logger.debug(`No manifest.json in ${appDir}, skipping`)
        continue
      }

      try {
        const manifestContent = fs.readFileSync(manifestPath, 'utf-8')
        const manifest = JSON.parse(manifestContent) as SubAppManifest
        apps.push({ id: manifest.id, manifest, path: appDir, source: 'user' })
      } catch (err) {
        logger.warn(`Failed to read manifest in ${appDir}:`, err)
      }
    }
  } catch (err) {
    logger.error(`Failed to scan apps directory ${dir}:`, err)
  }

  return apps
}

/**
 * Lists all available sub-apps from the user apps directory.
 */
export function listSubApps(): SubAppInfo[] {
  return scanAppsDir(getUserAppsPath())
}

/**
 * Returns the manifest for a specific app by id.
 */
export function getManifest(appId: string): SubAppManifest | undefined {
  const allApps = listSubApps()
  const app = allApps.find((a) => a.manifest.id === appId)
  return app?.manifest
}

/**
 * Resolves the directory path for a specific sub-app.
 */
export function getSubAppPath(appId: string): string | undefined {
  const allApps = listSubApps()
  const app = allApps.find((a) => a.manifest.id === appId)
  return app?.path
}

/**
 * Installs a sub-app by copying it to the user apps directory.
 */
export function installApp(
  sourcePath: string
): { success: boolean; manifest?: SubAppManifest; error?: string } {
  try {
    if (!fs.existsSync(sourcePath)) {
      return { success: false, error: `Source path does not exist: ${sourcePath}` }
    }

    const manifestPath = join(sourcePath, 'manifest.json')
    if (!fs.existsSync(manifestPath)) {
      return { success: false, error: 'No manifest.json found in source directory' }
    }

    const manifestContent = fs.readFileSync(manifestPath, 'utf-8')
    const manifest = JSON.parse(manifestContent) as SubAppManifest

    const userAppsDir = getUserAppsPath()
    if (!fs.existsSync(userAppsDir)) {
      fs.mkdirSync(userAppsDir, { recursive: true })
    }

    const targetDir = join(userAppsDir, manifest.id || basename(sourcePath))
    if (fs.existsSync(targetDir)) {
      fs.rmSync(targetDir, { recursive: true })
    }

    fs.cpSync(sourcePath, targetDir, { recursive: true })
    logger.info(`App installed: ${manifest.name} (${manifest.id}) to ${targetDir}`)

    return { success: true, manifest }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error('Failed to install app:', message)
    return { success: false, error: message }
  }
}

/**
 * Uninstalls a user-installed sub-app by removing its directory.
 */
export function uninstallApp(appId: string): { success: boolean; error?: string } {
  try {
    const allApps = listSubApps()
    const app = allApps.find((a) => a.manifest.id === appId)

    if (!app) {
      return { success: false, error: `App not found: ${appId}` }
    }

    fs.rmSync(app.path, { recursive: true })
    logger.info(`App uninstalled: ${appId}`)

    return { success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error('Failed to uninstall app:', message)
    return { success: false, error: message }
  }
}

import fs from 'fs'
import { join, resolve, relative, isAbsolute, sep } from 'path'
import { getUserAppsPath, getDefaultUserAppsPath } from '../utils/paths'
import * as logger from '../utils/logger'

export interface SubAppManifest {
  id: string
  name: string
  version: string
  description: string
  entry: string
  icon?: string
  type?: 'app' | 'ai-skill' | 'prompt' | 'link'
  url?: string
  mini?: boolean
  author?: string | { name: string; email?: string; feishu_id?: string }
  category?: string
  published?: boolean
  params?: Array<{ name: string; type: string; [key: string]: unknown }>
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

/** Allowed shape of a manifest id (it becomes a directory name under user-apps). */
const MANIFEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/** Builtin-app id prefix (mirrors project.service BUILTIN_APP_ID_PREFIX; kept local to avoid an import cycle). */
const BUILTIN_PREFIX = 'com.clawbench.builtin.'

/** Legacy marketplace ids fall back to a backend-generated UUID instead of manifest.id. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Validates a manifest id before it is used as a directory name.
 * Returns an error message, or null when the id is safe.
 */
export function validateManifestId(id: unknown): string | null {
  if (typeof id !== 'string' || !id) return 'manifest.json is missing a valid "id"'
  if (id.length > 200) return `Invalid manifest id (too long): ${id.slice(0, 40)}...`
  if (!MANIFEST_ID_PATTERN.test(id) || id.includes('..')) {
    return `Invalid manifest id "${id}": only letters, digits, ".", "_" and "-" are allowed`
  }
  return null
}

/** True when `target` resolves strictly inside `root` (never equal to it). */
export function isStrictlyInside(root: string, target: string): boolean {
  const rel = relative(resolve(root), resolve(target))
  return !!rel && !rel.startsWith('..') && !isAbsolute(rel) && rel.split(sep)[0] !== '..'
}

/** Roots the app manager is allowed to delete from (configured + default user-apps). */
function managedAppRoots(): string[] {
  const roots = new Set<string>()
  for (const fn of [getUserAppsPath, getDefaultUserAppsPath]) {
    try {
      const r = fn()
      if (r) roots.add(resolve(r))
    } catch {
      // paths unavailable (early bootstrap / tests)
    }
  }
  return [...roots]
}

/** True when `target` is strictly inside one of the managed user-apps roots. */
export function isInsideManagedAppsRoot(target: string): boolean {
  return managedAppRoots().some((root) => isStrictlyInside(root, target))
}

/**
 * Checks a downloaded package's manifest id against the id the caller asked
 * to install. Marketplace ids are normally the manifest id; legacy entries may
 * carry a backend UUID instead, in which case the mismatch is tolerated —
 * except that such a package may never claim a builtin id.
 */
export function checkExpectedManifestId(manifestId: string, expectedId: string): string | null {
  if (!expectedId || manifestId === expectedId) return null
  if (UUID_PATTERN.test(expectedId) && !manifestId.startsWith(BUILTIN_PREFIX)) return null
  return `Package manifest id "${manifestId}" does not match the requested app "${expectedId}"`
}

/**
 * Installs a sub-app by copying it to the user apps directory.
 *
 * When `opts.preserveLocal` is true (used for updates), the target directory is
 * NOT deleted before copying. `fs.cpSync({ recursive: true })` overwrites
 * same-named files with the new version while leaving locally-generated files
 * (e.g. Python sub-app `data/`, `output/`, logs, user edits) untouched.
 */
export function installApp(
  sourcePath: string,
  opts: { preserveLocal?: boolean; expectedId?: string } = {}
): { success: boolean; manifest?: SubAppManifest; error?: string; targetDir?: string } {
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

    // manifest.id becomes a directory name: reject traversal / odd characters.
    const idError = validateManifestId(manifest?.id)
    if (idError) {
      return { success: false, error: idError }
    }
    if (opts.expectedId) {
      const mismatch = checkExpectedManifestId(manifest.id, opts.expectedId)
      if (mismatch) {
        return { success: false, error: mismatch }
      }
      if (manifest.id !== opts.expectedId) {
        logger.warn(
          `Installing legacy market app ${opts.expectedId} under manifest id ${manifest.id}`
        )
      }
    }

    const userAppsDir = getUserAppsPath()
    if (!fs.existsSync(userAppsDir)) {
      fs.mkdirSync(userAppsDir, { recursive: true })
    }

    const targetDir = join(userAppsDir, manifest.id)
    if (!isStrictlyInside(userAppsDir, targetDir)) {
      return { success: false, error: `Refusing to install outside the apps directory: ${manifest.id}` }
    }
    if (fs.existsSync(targetDir) && !opts.preserveLocal) {
      fs.rmSync(targetDir, { recursive: true })
    }

    fs.cpSync(sourcePath, targetDir, { recursive: true })
    if (opts.preserveLocal) {
      logger.info(`App updated (merged, local files preserved): ${manifest.name} (${manifest.id}) at ${targetDir}`)
    } else {
      logger.info(`App installed: ${manifest.name} (${manifest.id}) to ${targetDir}`)
    }

    return { success: true, manifest, targetDir }
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

    // Only ever delete directories the app manager owns.
    if (!isInsideManagedAppsRoot(app.path)) {
      logger.error(`Refusing to uninstall ${appId}: ${app.path} is outside the managed apps directory`)
      return { success: false, error: `Refusing to remove a path outside the apps directory: ${app.path}` }
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

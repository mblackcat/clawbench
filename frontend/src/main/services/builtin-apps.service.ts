import fs from 'fs'
import { join } from 'path'
import { getBuiltinAppsPath, getUserAppsPath } from '../utils/paths'
import { installApp } from './subapp.service'
import { reportBuiltinAppInstall } from './usage-tracking.service'
import { installAppRequirements } from './python-venv.service'
import { BUILTIN_APP_ID_PREFIX } from './project.service'
import * as logger from '../utils/logger'

/**
 * Compares two dotted version strings. Returns >0 when a is newer than b.
 */
function compareVersions(a: string, b: string): number {
  const pa = String(a || '0').split('.')
  const pb = String(b || '0').split('.')
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const na = parseInt(pa[i] || '0', 10) || 0
    const nb = parseInt(pb[i] || '0', 10) || 0
    if (na !== nb) return na - nb
  }
  return 0
}

function readManifest(dir: string): { id?: string; version?: string; name?: string } | null {
  try {
    const raw = fs.readFileSync(join(dir, 'manifest.json'), 'utf-8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}


/**
 * Derives the common_apps app_key from a builtin manifest id. Builtin ids are
 * `${BUILTIN_APP_ID_PREFIX}${appKey}`; falls back to the raw id if the prefix
 * is ever absent.
 */
function builtinAppKey(manifestId: string): string {
  return manifestId.startsWith(BUILTIN_APP_ID_PREFIX)
    ? manifestId.slice(BUILTIN_APP_ID_PREFIX.length)
    : manifestId
}

function findBundledBuiltinSource(appId: string): string | null {
  const builtinDir = getBuiltinAppsPath()
  if (!fs.existsSync(builtinDir)) return null
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(builtinDir, { withFileTypes: true })
  } catch {
    return null
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const sourceDir = join(builtinDir, entry.name)
    const manifest = readManifest(sourceDir)
    if (manifest?.id === appId) return sourceDir
  }
  // Fallback: folder name matches last segment of id
  const key = builtinAppKey(appId)
  const byKey = join(builtinDir, key)
  if (fs.existsSync(byKey)) return byKey
  return null
}

/**
 * Force-reinstall a builtin app from the bundled template (full replace).
 * Used when local version is ahead of the shipped/builtin baseline.
 */
export function resetBuiltinApp(appId: string): { success: boolean; error?: string; version?: string } {
  if (!appId.startsWith(BUILTIN_APP_ID_PREFIX)) {
    return { success: false, error: `Not a builtin app id: ${appId}` }
  }
  const sourceDir = findBundledBuiltinSource(appId)
  if (!sourceDir) {
    return { success: false, error: `Bundled builtin source not found: ${appId}` }
  }
  const manifest = readManifest(sourceDir)
  const result = installApp(sourceDir) // full replace, no preserveLocal
  if (!result.success) {
    return { success: false, error: result.error || 'Reset failed' }
  }
  void reportBuiltinAppInstall(builtinAppKey(appId), manifest?.version)
  logger.info(`[builtin-apps] Reset ${appId} to bundled v${manifest?.version || '?'}`)
  if (result.targetDir) {
    void installAppRequirements(result.targetDir).catch((err) => {
      logger.warn(`[builtin-apps] Failed to install requirements for ${appId}:`, err)
    })
  }
  return { success: true, version: manifest?.version }
}

/** Read bundled (shipped) version for a builtin app id, if present. */
export function getBundledBuiltinVersion(appId: string): string | null {
  const sourceDir = findBundledBuiltinSource(appId)
  if (!sourceDir) return null
  return readManifest(sourceDir)?.version || null
}

/**
 * Seeds bundled builtin template apps into the user-apps directory so they
 * show up in the workbench. Installs missing apps and upgrades installed
 * copies whose bundled version is newer; never downgrades and never touches
 * user-installed (non-builtin) apps. Tolerates a missing or empty bundle dir.
 */
export function seedBuiltinApps(): void {
  const builtinDir = getBuiltinAppsPath()
  if (!fs.existsSync(builtinDir)) {
    logger.debug(`[builtin-apps] No builtin apps directory: ${builtinDir}`)
    return
  }

  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(builtinDir, { withFileTypes: true })
  } catch (err) {
    logger.warn('[builtin-apps] Failed to read builtin apps directory:', err)
    return
  }

  const userAppsDir = getUserAppsPath()
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const sourceDir = join(builtinDir, entry.name)
    const manifest = readManifest(sourceDir)
    if (!manifest?.id || !manifest.id.startsWith(BUILTIN_APP_ID_PREFIX)) continue

    const installedManifest = readManifest(join(userAppsDir, manifest.id))
    if (installedManifest) {
      if (compareVersions(manifest.version || '0', installedManifest.version || '0') <= 0) {
        continue
      }
      // Upgrade: merge so any locally generated files (logs, data/) survive
      const result = installApp(sourceDir, { preserveLocal: true })
      if (result.success) {
        logger.info(
          `[builtin-apps] Upgraded ${manifest.id} ${installedManifest.version} -> ${manifest.version}`
        )
        void reportBuiltinAppInstall(builtinAppKey(manifest.id), manifest.version)
        if (result.targetDir) {
          void installAppRequirements(result.targetDir).catch((err) => {
            logger.warn(`[builtin-apps] Failed to install requirements for ${manifest.id}:`, err)
          })
        }
      }
    } else {
      const result = installApp(sourceDir)
      if (result.success) {
        logger.info(`[builtin-apps] Seeded ${manifest.id} v${manifest.version}`)
        void reportBuiltinAppInstall(builtinAppKey(manifest.id), manifest.version)
        if (result.targetDir) {
          void installAppRequirements(result.targetDir).catch((err) => {
            logger.warn(`[builtin-apps] Failed to install requirements for ${manifest.id}:`, err)
          })
        }
      } else {
        logger.warn(`[builtin-apps] Failed to seed ${manifest.id}: ${result.error}`)
      }
    }
  }
}

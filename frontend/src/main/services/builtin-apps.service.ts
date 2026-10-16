import fs from 'fs'
import { join } from 'path'
import { getBuiltinAppsPath, getUserAppsPath } from '../utils/paths'
import { installApp } from './subapp.service'
import { reportBuiltinAppInstall } from './usage-tracking.service'
import { installAppRequirements } from './python-venv.service'
import { BUILTIN_APP_ID_PREFIX } from './project.service'
import { settingsStore } from '../store/settings.store'
import * as logger from '../utils/logger'

// ─── User-removed builtins ───────────────────────────────────────────────────

/** Builtin ids the user deleted; {@link seedBuiltinApps} skips them. */
export function getRemovedBuiltinApps(): string[] {
  const list = settingsStore.get('removedBuiltinApps')
  return Array.isArray(list) ? list.filter((id): id is string => typeof id === 'string') : []
}

/** Record that the user deleted a builtin so startup seeding won't bring it back. */
export function markBuiltinAppRemoved(appId: string): void {
  if (!appId.startsWith(BUILTIN_APP_ID_PREFIX)) return
  const list = getRemovedBuiltinApps()
  if (!list.includes(appId)) settingsStore.set('removedBuiltinApps', [...list, appId])
}

/** The user (re)installed / reset a builtin: let seeding manage it again. */
export function clearBuiltinAppRemoved(appId: string): void {
  const list = getRemovedBuiltinApps()
  if (list.includes(appId)) settingsStore.set('removedBuiltinApps', list.filter((id) => id !== appId))
}

// ─── Shipped-file record (for pruning on upgrade) ────────────────────────────

/** Written into each seeded builtin: relative paths of the files we shipped. */
export const BUNDLED_FILES_RECORD = '.cb-bundled-files.json'

/**
 * Top-level directories treated as user data and never pruned, even if a
 * previous bundle shipped files there (e.g. a seed `data/` template).
 */
const PRESERVED_DIRS = new Set(['data', 'output', 'outputs', 'logs', 'log', '.venv', 'venv', '__pycache__'])

/** Relative (POSIX-style) paths of every regular file under `dir`. */
export function listRelativeFiles(dir: string, base = ''): string[] {
  const out: string[] = []
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(join(dir, base), { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const rel = base ? `${base}/${entry.name}` : entry.name
    if (entry.isDirectory()) out.push(...listRelativeFiles(dir, rel))
    else if (entry.isFile()) out.push(rel)
  }
  return out
}

function readBundledFilesRecord(targetDir: string): string[] | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(join(targetDir, BUNDLED_FILES_RECORD), 'utf-8'))
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : null
  } catch {
    return null
  }
}

function writeBundledFilesRecord(targetDir: string, files: string[]): void {
  try {
    fs.writeFileSync(join(targetDir, BUNDLED_FILES_RECORD), JSON.stringify(files.filter((f) => f !== BUNDLED_FILES_RECORD)))
  } catch (err) {
    logger.warn(`[builtin-apps] Failed to write ${BUNDLED_FILES_RECORD} in ${targetDir}:`, err)
  }
}

/**
 * Files to delete when upgrading `targetDir` to a bundle containing `newFiles`.
 *
 * Conservative by design: only files that a *previous bundle* shipped (per the
 * recorded file list) and the new bundle no longer contains are removed —
 * never user-created files, never anything under a user-data dir, and nothing
 * at all when no record exists (installs that predate the record).
 */
export function computeFilesToPrune(previouslyShipped: string[] | null, newFiles: string[]): string[] {
  if (!previouslyShipped) return []
  const keep = new Set(newFiles)
  return previouslyShipped.filter((rel) => {
    if (keep.has(rel) || rel === BUNDLED_FILES_RECORD) return false
    if (rel.split('/').some((seg) => seg === '..' || seg === '')) return false
    const top = rel.split('/')[0]
    return !PRESERVED_DIRS.has(top)
  })
}

function pruneRemovedBundleFiles(targetDir: string, toPrune: string[]): void {
  for (const rel of toPrune) {
    const full = join(targetDir, ...rel.split('/'))
    try {
      if (fs.existsSync(full) && fs.statSync(full).isFile()) {
        fs.rmSync(full)
        logger.info(`[builtin-apps] Pruned file removed upstream: ${full}`)
      }
    } catch (err) {
      logger.warn(`[builtin-apps] Failed to prune ${full}:`, err)
    }
  }
}

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
  clearBuiltinAppRemoved(appId)
  if (result.targetDir) writeBundledFilesRecord(result.targetDir, listRelativeFiles(sourceDir))
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
  const removed = new Set(getRemovedBuiltinApps())
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const sourceDir = join(builtinDir, entry.name)
    const manifest = readManifest(sourceDir)
    if (!manifest?.id || !manifest.id.startsWith(BUILTIN_APP_ID_PREFIX)) continue

    const installedDir = join(userAppsDir, manifest.id)
    const installedManifest = readManifest(installedDir)
    if (!installedManifest && removed.has(manifest.id)) {
      logger.debug(`[builtin-apps] Skipping ${manifest.id}: removed by the user`)
      continue
    }
    if (installedManifest) {
      if (compareVersions(manifest.version || '0', installedManifest.version || '0') <= 0) {
        continue
      }
      // Upgrade: merge so any locally generated files (logs, data/) survive,
      // then drop files the new bundle no longer ships (see computeFilesToPrune).
      const newFiles = listRelativeFiles(sourceDir)
      const toPrune = computeFilesToPrune(readBundledFilesRecord(installedDir), newFiles)
      const result = installApp(sourceDir, { preserveLocal: true })
      if (result.success) {
        if (result.targetDir) {
          pruneRemovedBundleFiles(result.targetDir, toPrune)
          writeBundledFilesRecord(result.targetDir, newFiles)
        }
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
        if (result.targetDir) writeBundledFilesRecord(result.targetDir, listRelativeFiles(sourceDir))
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

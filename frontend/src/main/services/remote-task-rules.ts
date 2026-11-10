/**
 * Pure decision rules for remote (server-dispatched) tasks — no Electron
 * imports, so they are unit-testable. See docs/REMOTE_TASK_DISPATCH.md.
 */
import type { RemoteTaskMode } from '../store/settings.store'

export interface RemoteTask {
  taskId: string
  appId: string
  appName: string
  appVersion: string
  packageSha256: string
  presetParams: Record<string, unknown>
  forceConfirm: boolean
  autoInstall: boolean
  reason?: string | null
  dispatchedByName?: string | null
  executionStatus: 'RECEIVED' | 'WAITING_CONFIRM'
  expiresAt: number
  /** The user confirmed it in the renderer (params may have been edited). */
  confirmed?: boolean
  /** Set when the app must be installed / upgraded before it can run. */
  installAction?: 'install' | 'upgrade'
  /** Installed version, when any. */
  localVersion?: string
}

export interface RemoteTaskManifestLike {
  version: string
  type?: string
  confirm_before_run?: unknown
  params?: Array<{ name: string; type: string; required?: unknown; [key: string]: unknown }>
}

/** Same shape the backend accepts (and the desktop uses as a directory name). */
const APP_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/i

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Validates a pulled task before anything acts on it: the app id must be a
 * plain manifest id (no path tricks), the version/hash well-formed, the params
 * a plain object. Returns a normalized copy, or null when invalid.
 */
export function normalizeRemoteTask(raw: unknown): RemoteTask | null {
  if (!isPlainObject(raw)) return null
  const {
    taskId,
    appId,
    appName,
    appVersion,
    packageSha256,
    presetParams,
    forceConfirm,
    autoInstall,
    reason,
    dispatchedByName,
    executionStatus,
    expiresAt
  } = raw
  if (typeof taskId !== 'string' || !taskId || taskId.length > 128) return null
  if (typeof appId !== 'string' || appId.length > 255 || !APP_ID_PATTERN.test(appId)) return null
  if (typeof appVersion !== 'string' || !VERSION_PATTERN.test(appVersion)) return null
  if (typeof packageSha256 !== 'string' || !SHA256_PATTERN.test(packageSha256)) return null
  if (presetParams !== undefined && presetParams !== null && !isPlainObject(presetParams)) return null
  return {
    taskId,
    appId,
    appName: typeof appName === 'string' && appName ? appName : appId,
    appVersion,
    packageSha256,
    presetParams: isPlainObject(presetParams) ? presetParams : {},
    forceConfirm: forceConfirm === true,
    autoInstall: autoInstall === true,
    reason: typeof reason === 'string' ? reason : null,
    dispatchedByName: typeof dispatchedByName === 'string' ? dispatchedByName : null,
    executionStatus: executionStatus === 'WAITING_CONFIRM' ? 'WAITING_CONFIRM' : 'RECEIVED',
    expiresAt: typeof expiresAt === 'number' ? expiresAt : 0
  }
}

/** Compares dotted versions numerically (`1.10.0` > `1.9.0`). >0 when a is newer. */
export function compareVersions(a: string, b: string): number {
  const pa = String(a || '0').split(/[.+-]/)
  const pb = String(b || '0').split(/[.+-]/)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const na = parseInt(pa[i] || '0', 10) || 0
    const nb = parseInt(pb[i] || '0', 10) || 0
    if (na !== nb) return na - nb
  }
  return 0
}

export type InstallPlan =
  | { action: 'run' }
  | { action: 'install' | 'upgrade' }
  | { action: 'skip'; reasonCode: 'APP_NOT_INSTALLED' | 'VERSION_MISMATCH'; summary: string }

/** Decide whether the installed app can run as-is, needs (re)install, or must be skipped. Never downgrades. */
export function planInstall(task: RemoteTask, local: RemoteTaskManifestLike | undefined): InstallPlan {
  if (!local) {
    return task.autoInstall
      ? { action: 'install' }
      : {
          action: 'skip',
          reasonCode: 'APP_NOT_INSTALLED',
          summary: `Application ${task.appId} is not installed and autoInstall is false`
        }
  }
  const cmp = compareVersions(local.version, task.appVersion)
  if (cmp === 0) return { action: 'run' }
  if (cmp > 0) {
    return {
      action: 'skip',
      reasonCode: 'VERSION_MISMATCH',
      summary: `Local version (${local.version}) is newer than required (${task.appVersion})`
    }
  }
  return task.autoInstall
    ? { action: 'upgrade' }
    : {
        action: 'skip',
        reasonCode: 'VERSION_MISMATCH',
        summary: `Local version (${local.version}) is older than required (${task.appVersion}), and autoInstall is false`
      }
}

/**
 * Whether the user must review and confirm before the task runs.
 *
 * ClawBench is stricter than the server-side prediction: besides the
 * dispatcher's `forceConfirm`, the manifest's `confirm_before_run`, missing
 * required params and preset path/text params, it always confirms in
 * `always-confirm` mode (the default) and whenever the app has to be
 * installed or upgraded first (no silent code download).
 */
export function needsConfirm(
  task: RemoteTask,
  manifest: RemoteTaskManifestLike | undefined,
  mode: RemoteTaskMode
): boolean {
  if (mode !== 'silent') return true
  if (task.installAction || !manifest) return true
  if (task.forceConfirm || manifest.confirm_before_run === true) return true
  const params = manifest.params ?? []
  const missingRequired = params.some((p) => {
    const value = task.presetParams[p.name]
    return p.required === true && (value === undefined || value === null || value === '')
  })
  const sensitive = params.some(
    (p) => (p.type === 'path' || p.type === 'text') && task.presetParams[p.name] !== undefined
  )
  return missingRequired || sensitive
}

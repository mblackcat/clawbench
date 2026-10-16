import {
  getActiveProject,
  getCommonAppConfigCache,
  setCommonAppConfigCache
} from '../store/settings.store'
import { getApiToken } from '../store/api-credentials.store'
import { mainT } from '../utils/i18n'
import * as logger from '../utils/logger'

/** Thrown when a builtin common app is kill-switched by admin enable control. */
export class AppDisabledError extends Error {
  readonly i18nKey = 'subapp.appDisabledNamed'
  readonly i18nArgs: string[]

  constructor(appName: string) {
    super(mainT('subapp.appDisabledNamed', appName))
    this.name = 'AppDisabledError'
    this.i18nArgs = [appName]
  }
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api/v1'

/** Manifest id prefix marking apps seeded from builtin-apps/. */
export const BUILTIN_APP_ID_PREFIX = 'com.clawbench.builtin.'

export interface CommonAppRuntime {
  appKey: string
  name: string
  /** Effective enable (global && project). */
  enabled: boolean
  globalEnabled?: boolean
  projectEnabled?: boolean
  config: Record<string, unknown>
}

export type CommonAppsFetchSource = 'network' | 'cache' | 'empty'

export interface CommonAppsFetchResult {
  apps: CommonAppRuntime[]
  /** Only a successful network response is authoritative for enable/disable. */
  source: CommonAppsFetchSource
}

/**
 * Fetches effectively-enabled common apps for a project (global && project enable).
 * Falls back to cache when offline / not logged in.
 */
export async function fetchProjectCommonApps(projectId: string): Promise<CommonAppsFetchResult> {
  const token = getApiToken()
  if (token) {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 8000)
      const resp = await fetch(`${API_BASE_URL}/projects/${projectId}/common-apps`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal
      })
      clearTimeout(timeout)
      if (resp.ok) {
        const body = (await resp.json()) as {
          success?: boolean
          data?: { commonApps?: CommonAppRuntime[] }
        }
        const apps = body?.data?.commonApps
        if (Array.isArray(apps)) {
          setCommonAppConfigCache(projectId, apps)
          return { apps, source: 'network' }
        }
      } else {
        logger.warn(`[project] Fetch common apps failed: HTTP ${resp.status}`)
      }
    } catch (err) {
      logger.warn(
        '[project] Fetch common apps failed, using cache:',
        err instanceof Error ? err.message : String(err)
      )
    }
  }

  const cached = getCommonAppConfigCache(projectId)
  if (Array.isArray(cached)) {
    return { apps: cached as CommonAppRuntime[], source: 'cache' }
  }
  return { apps: [], source: 'empty' }
}

/**
 * Global common-apps list (includes disabled). Used when no project is selected
 * so App Manage kill-switch still blocks runs.
 */
async function fetchGlobalCommonApps(): Promise<CommonAppsFetchResult> {
  const token = getApiToken()
  if (!token) return { apps: [], source: 'empty' }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)
    const resp = await fetch(`${API_BASE_URL}/common-apps`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal
    })
    clearTimeout(timeout)
    if (resp.ok) {
      const body = (await resp.json()) as {
        success?: boolean
        data?: { commonApps?: CommonAppRuntime[] }
      }
      const apps = body?.data?.commonApps
      if (Array.isArray(apps)) {
        return { apps, source: 'network' }
      }
    } else {
      logger.warn(`[project] Fetch global common apps failed: HTTP ${resp.status}`)
    }
  } catch (err) {
    logger.warn(
      '[project] Fetch global common apps failed:',
      err instanceof Error ? err.message : String(err)
    )
  }
  return { apps: [], source: 'empty' }
}

/**
 * Synchronous allow-list of effectively-enabled builtin appKeys from cache.
 * Used by shortcuts / UI ordering so digits match the favorites grid.
 * Returns null when unknown (no project / no cache) → caller should not hide.
 */
export function getCachedEnabledBuiltinKeys(): Set<string> | null {
  const project = getActiveProject()
  if (!project) return null
  const cached = getCommonAppConfigCache(project.projectId)
  if (!Array.isArray(cached)) return null
  const keys = new Set<string>()
  for (const entry of cached) {
    if (entry && typeof entry === 'object' && typeof (entry as { appKey?: unknown }).appKey === 'string') {
      const appKey = (entry as { appKey: string }).appKey
      const enabled = (entry as { enabled?: unknown }).enabled
      // Project list is already effective-enabled; still honor explicit false if present.
      if (enabled === false) continue
      keys.add(appKey)
    }
  }
  return keys
}

/**
 * Prefetch project common-apps into cache (best-effort). Call on project switch / startup.
 */
export async function warmProjectCommonAppsCache(projectId?: string): Promise<void> {
  const id = projectId ?? getActiveProject()?.projectId
  if (!id) return
  await fetchProjectCommonApps(id)
}

/**
 * Enriches params for a builtin app run with reserved keys consumed by the
 * Python side: `__project`, `__app_config`.
 *
 * Enable gate (authoritative network only):
 * - With active project: missing from project common-apps list OR enabled=false
 *   → disabled (list is effective-enabled only: global && project).
 * - Without project: global common-apps enabled===false → disabled.
 * Cache/empty are not definitive (avoid false positives offline).
 */
export async function enrichBuiltinAppParams(
  appId: string,
  appName: string,
  params: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const appKey = appId.slice(BUILTIN_APP_ID_PREFIX.length)
  const enriched: Record<string, unknown> = { ...params }

  const project = getActiveProject()
  if (project) {
    enriched.__project = project
    const { apps, source } = await fetchProjectCommonApps(project.projectId)
    const match = apps.find((a) => a.appKey === appKey)
    if (match) {
      if (match.enabled === false) {
        throw new AppDisabledError(appName)
      }
      enriched.__app_config = match.config ?? {}
    } else if (source === 'network') {
      // Endpoint only returns effectively-enabled apps.
      throw new AppDisabledError(appName)
    }
    return enriched
  }

  // No active project: still honor global App Manage kill-switch.
  const { apps, source } = await fetchGlobalCommonApps()
  if (source === 'network') {
    const match = apps.find((a) => a.appKey === appKey)
    if (!match || match.enabled === false) {
      throw new AppDisabledError(appName)
    }
    enriched.__app_config = match.config ?? {}
  }

  return enriched
}

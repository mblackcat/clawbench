/**
 * Workbench / Discover / Mine card status resolution.
 *
 * Origins:
 *  - own: authored by current user
 *  - builtin: com.clawbench.builtin.*
 *  - installed: market-installed (not own, not builtin)
 */

export type AppOrigin = 'own' | 'builtin' | 'installed'

/** Visual / semantic status shown as a tag on cards */
export type AppCardStatus =
  | 'draft' // own, not published
  | 'published' // own, published, versions equal
  | 'pending_publish' // own, local > remote
  | 'pending_update' // local < remote (any origin)
  | 'builtin' // builtin, versions equal / no remote
  | 'reset_builtin' // builtin, local > remote
  | 'installed' // market install, versions equal / no remote
  | 'reset_online' // market install, local > remote
  | 'remote_only' // mine: owned on server, missing locally

export type VersionCompare = -1 | 0 | 1

/** Compare dotted semver-ish strings. -1 if a<b, 0 equal, 1 if a>b. */
export function compareVersions(a: string | undefined | null, b: string | undefined | null): VersionCompare {
  const pa = String(a || '0')
    .split('.')
    .map((p) => parseInt(p, 10) || 0)
  const pb = String(b || '0')
    .split('.')
    .map((p) => parseInt(p, 10) || 0)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const na = pa[i] || 0
    const nb = pb[i] || 0
    if (na < nb) return -1
    if (na > nb) return 1
  }
  return 0
}

export interface ResolveLocalStatusInput {
  origin: AppOrigin
  /** Own apps only — whether marketplace / published flag says published */
  isPublished?: boolean
  localVersion?: string
  /** Marketplace / common_apps / bundled version when known */
  remoteVersion?: string | null
}

/**
 * Resolve status tag for a locally-present app (homepage / mine with local files).
 */
export function resolveLocalAppStatus(input: ResolveLocalStatusInput): AppCardStatus {
  const { origin, isPublished, localVersion, remoteVersion } = input
  const hasRemote = !!(remoteVersion && String(remoteVersion).trim())
  const cmp = hasRemote ? compareVersions(localVersion, remoteVersion) : 0

  if (origin === 'builtin') {
    if (!hasRemote) return 'builtin'
    if (cmp < 0) return 'pending_update'
    if (cmp > 0) return 'reset_builtin'
    return 'builtin'
  }

  if (origin === 'own') {
    if (!isPublished) return 'draft'
    if (!hasRemote) return 'published'
    if (cmp < 0) return 'pending_update'
    if (cmp > 0) return 'pending_publish'
    return 'published'
  }

  // installed (others)
  if (!hasRemote) return 'installed'
  if (cmp < 0) return 'pending_update'
  if (cmp > 0) return 'reset_online'
  return 'installed'
}

/** Discover marketplace card status (relative to local install). */
export type DiscoverCardStatus =
  | 'not_installed'
  | 'installed'
  | 'pending_update'
  | 'reset_online'

export function resolveDiscoverStatus(
  localVersion: string | undefined | null,
  remoteVersion: string | undefined | null,
  isInstalled: boolean
): DiscoverCardStatus {
  if (!isInstalled) return 'not_installed'
  if (!localVersion || !remoteVersion) return 'installed'
  const cmp = compareVersions(localVersion, remoteVersion)
  if (cmp < 0) return 'pending_update'
  if (cmp > 0) return 'reset_online'
  return 'installed'
}

/** i18n key for status tag label */
export function appStatusLabelKey(status: AppCardStatus): string {
  switch (status) {
    case 'draft':
      return 'appStatus.draft'
    case 'published':
      return 'appStatus.published'
    case 'pending_publish':
      return 'appStatus.pendingPublish'
    case 'pending_update':
      return 'appStatus.pendingUpdate'
    case 'builtin':
      return 'appStatus.builtin'
    case 'reset_builtin':
      return 'appStatus.resetBuiltin'
    case 'installed':
      return 'appStatus.installed'
    case 'reset_online':
      return 'appStatus.resetOnline'
    case 'remote_only':
      return 'appStatus.remoteOnly'
  }
}

/** antd Tag color */
export function appStatusTagColor(status: AppCardStatus): string {
  switch (status) {
    case 'draft':
      return 'orange'
    case 'published':
      return 'green'
    case 'pending_publish':
      return 'gold'
    case 'pending_update':
      return 'processing'
    case 'builtin':
      return 'blue'
    case 'reset_builtin':
      return 'warning'
    case 'installed':
      return 'default'
    case 'reset_online':
      return 'warning'
    case 'remote_only':
      return 'cyan'
  }
}

export function discoverStatusLabelKey(status: DiscoverCardStatus): string {
  switch (status) {
    case 'not_installed':
      return 'appStatus.notInstalled'
    case 'installed':
      return 'appStatus.installed'
    case 'pending_update':
      return 'appStatus.pendingUpdate'
    case 'reset_online':
      return 'appStatus.resetOnline'
  }
}

/** Whether version tag should show "local → remote" */
export function shouldShowVersionDiff(status: AppCardStatus | DiscoverCardStatus): boolean {
  return (
    status === 'pending_update' ||
    status === 'pending_publish' ||
    status === 'reset_builtin' ||
    status === 'reset_online'
  )
}

export const BUILTIN_APP_ID_PREFIX = 'com.clawbench.builtin.'

export function isBuiltinAppId(id: string | undefined | null): boolean {
  return !!id && id.startsWith(BUILTIN_APP_ID_PREFIX)
}

export function builtinAppKeyFromId(id: string): string {
  return id.startsWith(BUILTIN_APP_ID_PREFIX) ? id.slice(BUILTIN_APP_ID_PREFIX.length) : id
}

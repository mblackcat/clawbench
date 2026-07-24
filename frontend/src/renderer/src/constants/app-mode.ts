/**
 * Global app shell mode: 通用 (general) vs 研发 (pro / Dev).
 *
 * General mode hides the left sider for a focused workbench; all product
 * modules (workbench, AI Chat, AI Agents, OpenClaw, Hermes, AI Coding,
 * Terminal, Local Env, CoPiper, Developer) remain reachable — only the
 * sider collapses. Dev (研发) mode shows the full left menu.
 *
 * Pure helpers — no React / Electron dependencies so unit tests can exercise
 * them directly. Mirrors the Vexelbench design but defaults to `pro` to
 * preserve ClawBench's historical UX and NEVER drops AI routes.
 */

export type AppMode = 'general' | 'pro'

/** Default to 研发 (pro) so existing users keep the sidebar on first run. */
export const DEFAULT_APP_MODE: AppMode = 'pro'

export const APP_MODE_STORAGE_KEY = 'cb-app-mode'

/**
 * Pro-mode landing route when there is no usable lastRoute. Preserves the
 * historical RootRedirect default (`localStorage.getItem('lastRoute') || '/ai-chat'`).
 */
const PRO_DEFAULT_ROUTE = '/ai-chat'

/**
 * Routes reachable as center content while in 通用 (general) mode. ClawBench
 * keeps every product surface reachable in general mode — the only behavioral
 * difference is the left sider is hidden. Prefixes mirror the live routes in
 * `routes.tsx`.
 */
const GENERAL_MODE_PATH_PREFIXES = [
  '/workbench',
  '/settings',
  '/ai-chat',
  '/ai-agents',
  '/openclaw',
  '/ai-coding',
  '/ai-terminal',
  '/local-env',
  '/copiper',
  '/developer'
] as const

export function isAppMode(value: unknown): value is AppMode {
  return value === 'general' || value === 'pro'
}

export function normalizeAppMode(value: unknown): AppMode {
  return isAppMode(value) ? value : DEFAULT_APP_MODE
}

export function parseStoredAppMode(raw: string | null | undefined): AppMode {
  if (raw == null || raw === '') return DEFAULT_APP_MODE
  return normalizeAppMode(raw)
}

/** Whether the left sider should be visible for the given mode. */
export function shouldShowLeftSider(mode: AppMode): boolean {
  return mode === 'pro'
}

/**
 * Whether a path is allowed as center content in 通用 mode. Because ClawBench
 * keeps all product modules, this allow-list covers every live route prefix;
 * it only filters out stale/garbage lastRoutes.
 */
export function isGeneralModePath(pathname: string): boolean {
  if (!pathname) return false
  return GENERAL_MODE_PATH_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  )
}

export function generalModeFallbackPath(): string {
  return '/workbench/installed'
}

/**
 * Resolve the landing route from a persisted lastRoute + current mode.
 *
 * - General: restore lastRoute only if it is an allowed center path, else the
 *   workbench fallback.
 * - Pro: preserve the historical behaviour — lastRoute wins; auth routes and
 *   empty values fall back to `/ai-chat`. AI routes are ALWAYS preserved
 *   (never redirected away), unlike the Vexelbench fork which dropped them.
 */
export function resolveDefaultRoute(
  lastRoute: string | null | undefined,
  mode: AppMode
): string {
  if (mode === 'general') {
    if (lastRoute && isGeneralModePath(lastRoute)) return lastRoute
    return generalModeFallbackPath()
  }

  if (!lastRoute || lastRoute === '/' || lastRoute === '/login' || lastRoute === '/setup') {
    return PRO_DEFAULT_ROUTE
  }

  return lastRoute
}

/** Labels for the mode switch (i18n keys live elsewhere; pure text for tests). */
export const APP_MODE_LABELS = {
  general: { zh: '通用', en: 'General' },
  pro: { zh: '研发', en: 'Dev' }
} as const

// Re-export for callers that need the full list of prefixes (tests / audits)
export { GENERAL_MODE_PATH_PREFIXES }

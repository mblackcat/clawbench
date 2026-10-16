import type { SubAppInfo } from './subapp.service'

/** Manifest id prefix marking apps seeded from builtin-apps/. */
const BUILTIN_APP_ID_PREFIX = 'com.clawbench.builtin.'

function isRunnableApp(app: SubAppInfo): boolean {
  return app.source === 'user' && (app.manifest.type ?? 'app') === 'app'
}

function isBuiltinAppId(id: string): boolean {
  return id.startsWith(BUILTIN_APP_ID_PREFIX)
}

function builtinAppKeyFromId(id: string): string {
  return isBuiltinAppId(id) ? id.slice(BUILTIN_APP_ID_PREFIX.length) : id
}

/**
 * Apps eligible for global shortcuts, ordered like the favorites grid.
 * When `enabledBuiltinKeys` is provided, builtins not in the set are omitted
 * so shortcut digits match the workbench (project/global kill-switch).
 */
export function getShortcutApps(
  apps: SubAppInfo[],
  appOrder: string[],
  pinnedApps: string[] = [],
  enabledBuiltinKeys: Set<string> | null = null
): SubAppInfo[] {
  const shortcutApps = apps.filter(isRunnableApp).filter((app) => {
    if (!isBuiltinAppId(app.id) || enabledBuiltinKeys === null) return true
    return enabledBuiltinKeys.has(builtinAppKeyFromId(app.id))
  })

  if (appOrder.length === 0 && pinnedApps.length === 0) {
    return shortcutApps
  }

  // 与收藏栏展示顺序一致：置顶区在前，区内按 appOrder 排序
  const orderMap = new Map(appOrder.map((id, i) => [id, i]))
  const pinnedSet = new Set(pinnedApps)
  return [...shortcutApps].sort((a, b) => {
    const pa = pinnedSet.has(a.id) ? 0 : 1
    const pb = pinnedSet.has(b.id) ? 0 : 1
    if (pa !== pb) return pa - pb
    const ia = orderMap.get(a.id) ?? Infinity
    const ib = orderMap.get(b.id) ?? Infinity
    return ia - ib
  })
}

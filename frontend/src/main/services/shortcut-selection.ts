import type { SubAppInfo } from './subapp.service'

function isRunnableApp(app: SubAppInfo): boolean {
  return app.source === 'user' && (app.manifest.type ?? 'app') === 'app'
}

export function getShortcutApps(apps: SubAppInfo[], appOrder: string[]): SubAppInfo[] {
  const shortcutApps = apps.filter(isRunnableApp)

  if (appOrder.length === 0) {
    return shortcutApps
  }

  const orderMap = new Map(appOrder.map((id, i) => [id, i]))
  return [...shortcutApps].sort((a, b) => {
    const ia = orderMap.get(a.id) ?? Infinity
    const ib = orderMap.get(b.id) ?? Infinity
    return ia - ib
  })
}

/**
 * Merging admin (server) builtin pins into the user's `pinnedApps`.
 *
 * `pinnedApps` stays the single effective list the main process reads (global
 * shortcut order), so admin pins are folded into it. To tell an admin pin from
 * the user's own pin of the same builtin later, the last-applied admin pins are
 * remembered; when an admin withdraws a pin, only that pin is dropped — the
 * user's own pins (builtins included) are never replaced.
 */

const LAST_ADMIN_PINS_KEY = 'cb-admin-pinned-apps'

export function readLastAdminPins(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(LAST_ADMIN_PINS_KEY) || '[]')
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

export function writeLastAdminPins(ids: string[]): void {
  try {
    localStorage.setItem(LAST_ADMIN_PINS_KEY, JSON.stringify(ids))
  } catch {
    /* quota / private mode */
  }
}

/**
 * @param current        the user's effective pinnedApps
 * @param serverPinned   builtin ids an admin pins now
 * @param lastAdminPins  builtin ids admin-pinned at the previous sync
 * @returns admin pins first, then the user's remaining pins (order kept, deduped)
 */
export function mergeAdminPins(current: string[], serverPinned: string[], lastAdminPins: string[]): string[] {
  const now = new Set(serverPinned)
  const withdrawn = new Set(lastAdminPins.filter((id) => !now.has(id)))
  const out: string[] = []
  const seen = new Set<string>()
  for (const id of [...serverPinned, ...current.filter((id) => !withdrawn.has(id))]) {
    if (seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

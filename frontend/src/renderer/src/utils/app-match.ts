/**
 * Matching local apps ↔ marketplace apps.
 *
 * The manifest id (= marketplace applicationId) is authoritative. A name match
 * is only a fallback for legacy installs whose id differs from the market id,
 * and it is constrained so it can't attach an app to the wrong record:
 *  - same resource `type` only (an app and a prompt may share a name);
 *  - only when no id match exists, and never onto a counterpart that has its
 *    own id match elsewhere.
 */

export interface MatchableApp {
  id: string
  name: string
  type?: string | null
}

/** Treat a missing type as the default `app`. */
export function normalizeAppType(type: string | null | undefined): string {
  return type || 'app'
}

/** Key for the name fallback index (type-scoped). */
export function typedNameKey(name: string, type: string | null | undefined): string {
  return `${normalizeAppType(type)}:${name}`
}

/**
 * Find `local`'s counterpart among `candidates`.
 * @param claimedIds ids already owned by an exact id match on the other side
 *                   (e.g. every local manifest id when matching market apps);
 *                   name fallback never picks a candidate whose id is claimed.
 */
export function findCounterpart<T extends MatchableApp>(
  local: MatchableApp,
  candidates: Iterable<T>,
  claimedIds: ReadonlySet<string> = new Set()
): T | undefined {
  const list = Array.from(candidates)
  const byId = list.find((c) => c.id === local.id)
  if (byId) return byId
  const type = normalizeAppType(local.type)
  return list.find(
    (c) => c.name === local.name && normalizeAppType(c.type) === type && !claimedIds.has(c.id)
  )
}

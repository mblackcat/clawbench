/**
 * Which terminal tabs stay mounted.
 *
 * Remounting a terminal on every tab switch disposes xterm + its WebGL
 * context, fetches the session's raw replay buffer over IPC and re-parses up
 * to ~1MB of ANSI — and TUIs that repaint constantly keep that buffer full, so
 * switching got slower the longer a session ran. Recently used terminals are
 * kept mounted (hidden) instead; only a cold tab pays the replay.
 *
 * `ids` keeps first-seen order so React never reorders the mounted layers
 * (moving a node that holds a WebGL canvas is not free); `lastUsed` decides
 * which one to evict.
 */

/** Active tab plus a few recent ones; bounded by Chromium's WebGL context cap. */
export const TERMINAL_KEEP_ALIVE_MAX = 4

export interface KeepAliveState {
  ids: string[]
  lastUsed: Record<string, number>
  tick: number
}

export const EMPTY_KEEP_ALIVE: KeepAliveState = { ids: [], lastUsed: {}, tick: 0 }

/**
 * Next keep-alive set. `isEligible` drops tabs that were closed, switched to
 * chat view, or whose process ended (those must remount so the view relaunches
 * them, as before). The active tab is always kept while it is eligible.
 * Returns `prev` unchanged when nothing changed.
 */
export function nextKeepAlive(
  prev: KeepAliveState,
  activeId: string | null,
  isEligible: (id: string) => boolean,
  max: number = TERMINAL_KEEP_ALIVE_MAX
): KeepAliveState {
  const activeOk = !!activeId && isEligible(activeId)
  let ids = prev.ids.filter((id) => id === activeId ? activeOk : isEligible(id))
  let { lastUsed, tick } = prev
  let changed = ids.length !== prev.ids.length

  if (activeOk && activeId) {
    if (!ids.includes(activeId)) {
      ids = [...ids, activeId]
      changed = true
    }
    // `tick` is the latest stamp handed out, so this only bumps when a
    // different tab became active — re-renders on the same tab return `prev`.
    if (lastUsed[activeId] !== tick) {
      tick += 1
      lastUsed = { ...lastUsed, [activeId]: tick }
      changed = true
    }
  }

  while (ids.length > max) {
    const evict = ids
      .filter((id) => id !== activeId)
      .reduce((oldest, id) => (lastUsed[id] ?? -1) < (lastUsed[oldest] ?? -1) ? id : oldest)
    ids = ids.filter((id) => id !== evict)
    changed = true
  }

  if (!changed) return prev
  const kept = new Set(ids)
  const prunedLastUsed: Record<string, number> = {}
  for (const [id, used] of Object.entries(lastUsed)) if (kept.has(id)) prunedLastUsed[id] = used
  return { ids, lastUsed: prunedLastUsed, tick }
}

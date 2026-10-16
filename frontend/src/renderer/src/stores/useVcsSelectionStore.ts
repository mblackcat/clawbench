import { create } from 'zustand'
import type { VcsType } from '../types/ipc'

/**
 * Shared VCS selection state for the AI Coding module.
 *
 * The "Changes" panel (VcsChangesPanel) lets the user pick which VCS to operate
 * on when a working directory contains more than one (e.g. git + svn). That
 * choice must also drive:
 *   - the per-workspace +/- diff-stat badge in the left sidebar (AICodingSidebar)
 *   - the small g/s/p letter marker on the VCS toggle icon (PaneTabBar)
 *
 * State is keyed by working directory — the unit VCS detection runs on — so the
 * sidebar can resolve each workspace independently. It survives in memory
 * across panel open/close for the lifetime of the session.
 */
interface VcsSelectionState {
  /** User-chosen VCS per working directory. Absent entry = no explicit pick. */
  selection: Record<string, VcsType>
  /** Detected VCS list per working directory (priority git > svn > perforce). */
  available: Record<string, VcsType[]>
  setSelection: (workingDir: string, vcs: VcsType | null) => void
  setAvailable: (workingDir: string, list: VcsType[]) => void
  /** Effective VCS for a dir: the user pick if still detected, else the first
   *  detected, else 'none'. */
  resolveVcs: (workingDir: string) => VcsType
}

export const useVcsSelectionStore = create<VcsSelectionState>((set, get) => ({
  selection: {},
  available: {},
  setSelection: (workingDir, vcs) =>
    set((s) => {
      if (!workingDir) return s
      if (!vcs) {
        if (!(workingDir in s.selection)) return s
        const next = { ...s.selection }
        delete next[workingDir]
        return { selection: next }
      }
      if (s.selection[workingDir] === vcs) return s
      return { selection: { ...s.selection, [workingDir]: vcs } }
    }),
  setAvailable: (workingDir, list) =>
    set((s) => {
      if (!workingDir) return s
      // Background detection (sidebar poll) re-writes the same list on every
      // tick; bail out when nothing changed so subscribers don't re-render.
      const prev = s.available[workingDir]
      if (prev && prev.length === list.length && prev.every((v, i) => v === list[i])) return s
      return { available: { ...s.available, [workingDir]: list } }
    }),
  resolveVcs: (workingDir) => {
    if (!workingDir) return 'none'
    const list = get().available[workingDir]
    if (!list || list.length === 0) return 'none'
    const sel = get().selection[workingDir]
    if (sel && list.includes(sel)) return sel
    return list[0]
  },
}))

import { create } from 'zustand'

/**
 * run_after_install with a required param that has no default/saved value:
 * request the favorites page to open that app's params drawer so the user can
 * fill it in and run it manually. The nonce makes repeated requests for the
 * same app re-trigger.
 */
interface RunAfterInstallState {
  pending: { appId: string; nonce: number } | null
  requestParamsPrompt: (appId: string) => void
  clear: () => void
}

export const useRunAfterInstallStore = create<RunAfterInstallState>((set) => ({
  pending: null,
  requestParamsPrompt: (appId) => set({ pending: { appId, nonce: Date.now() } }),
  clear: () => set({ pending: null })
}))

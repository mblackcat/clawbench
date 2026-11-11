import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useSubAppStore } from '../stores/useSubAppStore'
import { useRunAfterInstallStore } from '../stores/useRunAfterInstallStore'

const FAVORITES_ROUTE = '/workbench/installed'

/**
 * Handles run_after_install params prompts: refreshes the installed list and
 * navigates to the favorites page, which opens the app's params drawer
 * (InstalledAppsPage consumes `useRunAfterInstallStore.pending`); the app only
 * runs after the user submits. Mounted once in AppLayout (needs router context).
 */
export function useRunAfterInstallPrompt(): void {
  const navigate = useNavigate()
  const location = useLocation()
  const pending = useRunAfterInstallStore((s) => s.pending)

  useEffect(() => {
    if (!pending) return
    let disposed = false
    const open = async (): Promise<void> => {
      // Just installed: the list may not contain the app yet
      try {
        await useSubAppStore.getState().fetchApps()
      } catch {
        // the favorites page loads again on mount
      }
      if (disposed) return
      if (location.pathname !== FAVORITES_ROUTE) navigate(FAVORITES_ROUTE)
    }
    void open()
    return () => {
      disposed = true
    }
    // Only react to new requests, not to route changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, navigate])
}

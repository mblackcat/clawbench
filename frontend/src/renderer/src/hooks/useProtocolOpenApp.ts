import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSubAppStore } from '../stores/useSubAppStore'
import { useAuthStore } from '../stores/useAuthStore'
import { applicationManager } from '../services/applicationManager'
import { isBuiltinAppId } from '../utils/app-status'

/**
 * Preview request passed to the workbench pages via `location.state`
 * (the nonce makes a repeated share link on the same page fire again).
 */
export interface AppPreviewLocationState {
  previewAppId?: string
  previewNonce?: number
  from?: string
}

type AppInfo = ReturnType<typeof useSubAppStore.getState>['appInfos'][number]

function findLocalApp(infos: AppInfo[], appId: string): AppInfo | undefined {
  return infos.find(
    (i) =>
      i.source === 'user' &&
      (!i.manifest.type || i.manifest.type === 'app') &&
      (i.id === appId || i.manifest.id === appId)
  )
}

type PendingOpenApp = Awaited<ReturnType<typeof window.api.protocol.takePendingOpenApp>>

/**
 * One in-flight take shared by concurrent callers: StrictMode mounts the
 * effect twice, and the first (immediately disposed) run must not swallow the
 * request the second run is meant to handle.
 */
let inflightTake: Promise<PendingOpenApp> | null = null
function takePendingOnce(): Promise<PendingOpenApp> {
  if (!inflightTake) {
    inflightTake = window.api.protocol.takePendingOpenApp().finally(() => {
      inflightTake = null
    })
  }
  return inflightTake
}

/**
 * Handle share links / landing page launches (`clawbench://open-app?id=...`):
 * - app installed locally → favorites page, locate the card and open its
 *   parameter drawer (running still needs the user's click);
 * - not installed → Discover page, open the app's detail drawer (installing
 *   still needs the user's click).
 *
 * The main process stores the request; it is pulled on mount and on every
 * nudge event (`takePendingOpenApp` returns it only once). Mounted inside the
 * logged-in AppLayout, so a request made before login waits in the main
 * process until then.
 */
export function useProtocolOpenApp(): void {
  const navigate = useNavigate()

  useEffect(() => {
    let disposed = false

    const resolveLocal = async (appId: string): Promise<AppInfo | undefined> => {
      const store = useSubAppStore.getState()
      let local = findLocalApp(store.appInfos, appId)
      if (!local) {
        // The list may not be loaded yet (or be stale right after an install).
        await store.fetchApps()
        local = findLocalApp(useSubAppStore.getState().appInfos, appId)
      }
      if (!local && !isBuiltinAppId(appId) && !useAuthStore.getState().isLocalMode) {
        // Legacy installs: local manifest.id may differ from the market id — match by name.
        try {
          const detail = await applicationManager.fetchApplicationDetail(appId)
          local = useSubAppStore
            .getState()
            .appInfos.find(
              (i) =>
                i.source === 'user' &&
                (!i.manifest.type || i.manifest.type === 'app') &&
                i.manifest.name === detail.name
            )
        } catch {
          // Not in the marketplace: the Discover page reports it.
        }
      }
      return local
    }

    const handlePending = async () => {
      const pending = await takePendingOnce()
      if (!pending || disposed) return
      const local = await resolveLocal(pending.appId)
      if (disposed) return
      const state: AppPreviewLocationState = {
        previewAppId: local ? local.id : pending.appId,
        previewNonce: Date.now()
      }
      navigate(local ? '/workbench/installed' : '/workbench/library', { state })
    }

    void handlePending()
    const unsubscribe = window.api.protocol.onOpenApp(() => {
      void handlePending()
    })
    return () => {
      disposed = true
      unsubscribe()
    }
  }, [navigate])
}

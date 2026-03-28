import { useEffect } from 'react'

/**
 * Custom hook for managing IPC event listeners.
 * Sets up a listener via the window.api object on mount and cleans up on unmount.
 *
 * @param channel - The IPC channel namespace and event, e.g. 'subapp' for onOutput
 * @param setup - A function that registers the listener and returns a cleanup/unsubscribe function
 */
export function useIpcListener(setup: () => (() => void) | undefined): void {
  useEffect(() => {
    const cleanup = setup()
    return () => {
      cleanup?.()
    }
  }, [setup])
}

import { useCallback, useEffect, useMemo, useState } from 'react'
import { App } from 'antd'
import { useSettingsStore } from '../stores/useSettingsStore'
import type { DetectedEnvironmentItem } from '../types/ipc'

export function isVsCodePath(p?: string | null): boolean {
  if (!p || typeof p !== 'string') return false
  const trimmed = p.trim().toLowerCase()
  return (
    /(?:^|[\\/])code(?:\.(?:exe|cmd|bat))?$/i.test(trimmed) ||
    /visual studio code/i.test(trimmed) ||
    /microsoft vs code/i.test(trimmed) ||
    /(?:^|[\\/])vscode(?:\.(?:exe|cmd|bat))?$/i.test(trimmed)
  )
}

export function isVsCodeItem(item: { id?: string; name?: string; path?: string }): boolean {
  if (!item) return false
  if (item.id === 'vscode') return true
  if (isVsCodePath(item.path)) return true
  const name = (item.name || '').toLowerCase()
  return name.includes('visual studio code') || name.includes('vscode') || name.includes('vs code')
}

/** Prefer a VS Code configured in Settings, else one found by the host IDE scan. */
export function resolveVsCode(
  availableIdes: DetectedEnvironmentItem[],
  localIdePath?: string
): { installed: boolean; path?: string } {
  if (isVsCodePath(localIdePath)) {
    return { installed: true, path: localIdePath }
  }
  const match = availableIdes.find(isVsCodeItem)
  if (match) {
    return { installed: true, path: match.path }
  }
  return { installed: false }
}

// The IDE scan spawns probes in the main process — share one result per app run.
let idesCache: DetectedEnvironmentItem[] | null = null
let idesPromise: Promise<DetectedEnvironmentItem[]> | null = null

/** Test-only: forget the cached IDE scan. */
export function resetWorkspaceOpenerCacheForTests(): void {
  idesCache = null
  idesPromise = null
}

function loadAvailableIdes(): Promise<DetectedEnvironmentItem[]> {
  if (idesCache) return Promise.resolve(idesCache)
  if (!idesPromise) {
    idesPromise = Promise.resolve(window.api?.developer?.getAvailableIdes?.() ?? [])
      .then((list) => {
        idesCache = Array.isArray(list) ? list : []
        return idesCache
      })
      .catch(() => [] as DetectedEnvironmentItem[])
      .finally(() => {
        idesPromise = null
      })
  }
  return idesPromise
}

/**
 * Open an AI Work workspace dir: in VS Code when it is installed, otherwise in
 * the OS file manager.
 */
export function useWorkspaceOpener(): {
  isVsCode: boolean
  vsCodePath?: string
  openWorkspace: (workingDir: string) => Promise<void>
} {
  const { message } = App.useApp()
  const localIdePath = useSettingsStore((s) => s.localIdePath)
  const [availableIdes, setAvailableIdes] = useState<DetectedEnvironmentItem[]>(idesCache ?? [])

  useEffect(() => {
    if (idesCache) return
    let cancelled = false
    void loadAvailableIdes().then((list) => {
      if (!cancelled) setAvailableIdes(list)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const vsCodeInfo = useMemo(() => resolveVsCode(availableIdes, localIdePath), [availableIdes, localIdePath])

  const openWorkspace = useCallback(
    async (workingDir: string) => {
      if (!workingDir) return
      try {
        if (vsCodeInfo.installed) {
          await window.api.developer.openInIde(workingDir, vsCodeInfo.path)
        } else {
          const errorMsg = await window.api.aiCoding.openDirectory(workingDir)
          if (errorMsg) message.error(errorMsg)
        }
      } catch (err: unknown) {
        message.error(err instanceof Error ? err.message : String(err))
      }
    },
    [message, vsCodeInfo]
  )

  return {
    isVsCode: vsCodeInfo.installed,
    vsCodePath: vsCodeInfo.path,
    openWorkspace
  }
}

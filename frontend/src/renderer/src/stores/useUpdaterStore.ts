import { create } from 'zustand'

export type UpdaterStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error'

interface UpdaterState {
  status: UpdaterStatus
  version: string | null
  downloadPercent: number
  errorMessage: string | null
  checked: boolean   // true once at least one check has completed
  init: () => () => void
  check: () => Promise<{ success: boolean; error?: string }>
  install: () => void
}

export const useUpdaterStore = create<UpdaterState>((set) => ({
  status: 'idle',
  version: null,
  downloadPercent: 0,
  errorMessage: null,
  checked: false,

  init: () => {
    const cleanups = [
      window.api.updater.onChecking(() => {
        set({ status: 'checking', errorMessage: null })
      }),
      window.api.updater.onAvailable((data) => {
        set({ status: 'available', version: data.version, checked: true })
      }),
      window.api.updater.onNotAvailable(() => {
        set({ status: 'idle', checked: true })
      }),
      window.api.updater.onProgress((data) => {
        set({ status: 'downloading', downloadPercent: data.percent })
      }),
      window.api.updater.onDownloaded((data) => {
        set({ status: 'downloaded', version: data.version, downloadPercent: 100, checked: true })
      }),
      window.api.updater.onError((data) => {
        set({ status: 'error', errorMessage: data.message, checked: true })
      })
    ]
    return () => cleanups.forEach((cleanup) => cleanup())
  },

  check: async () => {
    const result = await window.api.updater.check() as { success: boolean; error?: string }
    return result
  },

  install: () => {
    window.api.updater.install()
  }
}))

import { create } from 'zustand'
import type { AppSchedule, AppScheduleInput } from '../types/app-schedule'

interface AppScheduleState {
  schedules: AppSchedule[]
  loaded: boolean

  fetchSchedules: () => Promise<void>
  getScheduleByApp: (appId: string) => AppSchedule | undefined
  saveSchedule: (appId: string, data: AppScheduleInput) => Promise<AppSchedule>
  deleteSchedule: (appId: string) => Promise<void>
  setEnabled: (appId: string, enabled: boolean) => Promise<void>
  runNow: (appId: string) => Promise<{ success: boolean; error?: string }>
}

export const useAppScheduleStore = create<AppScheduleState>((set, get) => ({
  schedules: [],
  loaded: false,

  fetchSchedules: async () => {
    const schedules = await window.api.appSchedule.list()
    set({ schedules, loaded: true })
  },

  getScheduleByApp: (appId) => get().schedules.find((s) => s.appId === appId),

  saveSchedule: async (appId, data) => {
    const saved = await window.api.appSchedule.save(appId, data)
    set((state) => {
      const others = state.schedules.filter((s) => s.appId !== appId)
      return { schedules: [...others, saved] }
    })
    return saved
  },

  deleteSchedule: async (appId) => {
    await window.api.appSchedule.delete(appId)
    set((state) => ({ schedules: state.schedules.filter((s) => s.appId !== appId) }))
  },

  setEnabled: async (appId, enabled) => {
    const result = await window.api.appSchedule.setEnabled(appId, enabled)
    if (result) {
      set((state) => ({
        schedules: state.schedules.map((s) => (s.appId === appId ? { ...s, ...result } : s))
      }))
    }
  },

  runNow: async (appId) => {
    return await window.api.appSchedule.runNow(appId)
  }
}))

import { ipcMain } from 'electron'
import {
  listAppSchedules,
  getAppScheduleByApp,
  deleteAppScheduleByApp,
  upsertAppSchedule,
  updateAppSchedule,
  setAppScheduleEnabled,
  AppSchedule
} from '../store/app-schedule.store'
import { executeAppSchedule } from '../services/app-schedule.service'
import { computeNextRun } from '../utils/schedule-rule'
import { getManifest } from '../services/subapp.service'
import * as logger from '../utils/logger'

interface AppScheduleInput {
  appName: string
  enabled: boolean
  repeatRule: 'none' | 'daily' | 'weekly' | 'monthly'
  time: string
  dayOfWeek?: number
  dayOfMonth?: number
  endDate?: string
  params: Record<string, unknown>
}

/**
 * Default-fill any manifest params missing from the stored set so a schedule
 * keeps running when the app adds new optional params in a later version.
 */
function mergeDefaultParams(
  manifestParams: Array<{ name: string; default?: unknown }> | undefined,
  stored: Record<string, unknown>
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...stored }
  for (const p of manifestParams ?? []) {
    if (merged[p.name] === undefined && p.default !== undefined) {
      merged[p.name] = p.default
    }
  }
  return merged
}

/** Recompute nextRunAt for a schedule (when enabled) and persist it. */
function recomputeAndPersist(id: string, enabled: boolean): AppSchedule | undefined {
  const schedule = listAppSchedules().find((s) => s.id === id)
  if (!schedule) return undefined
  const nextRun = enabled ? computeNextRun(schedule) ?? undefined : undefined
  return updateAppSchedule(id, { nextRunAt: nextRun })
}

export function registerAppScheduleIpc(): void {
  ipcMain.handle('app-schedule:list', () => {
    return listAppSchedules()
  })

  ipcMain.handle('app-schedule:get-by-app', (_event, appId: string) => {
    return getAppScheduleByApp(appId)
  })

  ipcMain.handle('app-schedule:save', (_event, appId: string, input: AppScheduleInput) => {
    const manifest = getManifest(appId)
    const params = mergeDefaultParams(manifest?.params as any, input.params)

    const schedule = upsertAppSchedule(appId, {
      appName: input.appName || manifest?.name || appId,
      enabled: input.enabled,
      repeatRule: input.repeatRule,
      time: input.time,
      dayOfWeek: input.dayOfWeek,
      dayOfMonth: input.dayOfMonth,
      endDate: input.endDate,
      params
    })

    return recomputeAndPersist(schedule.id, schedule.enabled) ?? schedule
  })

  ipcMain.handle('app-schedule:delete', (_event, appId: string) => {
    return deleteAppScheduleByApp(appId)
  })

  ipcMain.handle('app-schedule:set-enabled', (_event, appId: string, enabled: boolean) => {
    const schedule = getAppScheduleByApp(appId)
    if (!schedule) return undefined
    setAppScheduleEnabled(schedule.id, enabled)
    return recomputeAndPersist(schedule.id, enabled)
  })

  ipcMain.handle('app-schedule:run-now', async (_event, appId: string) => {
    const schedule = getAppScheduleByApp(appId)
    if (!schedule) throw new Error('Schedule not found')
    try {
      await executeAppSchedule(schedule)
      return { success: true }
    } catch (err: any) {
      logger.error('[AppSchedule IPC] run-now failed:', err)
      return { success: false, error: err.message }
    }
  })
}

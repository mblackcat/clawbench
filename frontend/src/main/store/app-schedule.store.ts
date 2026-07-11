import Store from 'electron-store'
import { randomUUID } from 'crypto'

/**
 * A scheduled execution rule for an installed sub-app ("app" resource).
 * One schedule per app (keyed by appId) — creating a new schedule for an app
 * replaces any existing one.
 */
export interface AppSchedule {
  id: string
  appId: string
  appName: string
  enabled: boolean
  repeatRule: 'none' | 'daily' | 'weekly' | 'monthly'
  time: string // "HH:MM"
  dayOfWeek?: number // 0-6 (weekly)
  dayOfMonth?: number // 1-31 (monthly)
  endDate?: string // ISO date
  /** Execution params captured from the schedule editor (manifest.params shape). */
  params: Record<string, unknown>
  lastRunAt?: number
  lastRunStatus?: 'success' | 'error'
  lastRunSummary?: string
  nextRunAt?: number
  createdAt: number
  updatedAt: number
}

interface AppScheduleSchema {
  schedules: AppSchedule[]
}

export const appScheduleStore = new Store<AppScheduleSchema>({
  name: 'app-schedules',
  schema: {
    schedules: {
      type: 'array',
      default: [],
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          appId: { type: 'string' },
          appName: { type: 'string' },
          enabled: { type: 'boolean' },
          repeatRule: { type: 'string' },
          time: { type: 'string' },
          dayOfWeek: { type: 'number' },
          dayOfMonth: { type: 'number' },
          endDate: { type: 'string' },
          params: { type: 'object' },
          lastRunAt: { type: 'number' },
          lastRunStatus: { type: 'string' },
          lastRunSummary: { type: 'string' },
          nextRunAt: { type: 'number' },
          createdAt: { type: 'number' },
          updatedAt: { type: 'number' }
        }
      }
    }
  }
})

export function listAppSchedules(): AppSchedule[] {
  return appScheduleStore.get('schedules') || []
}

export function getAppSchedule(id: string): AppSchedule | undefined {
  return listAppSchedules().find((s) => s.id === id)
}

export function getAppScheduleByApp(appId: string): AppSchedule | undefined {
  return listAppSchedules().find((s) => s.appId === appId)
}

export function createAppSchedule(
  data: Omit<AppSchedule, 'id' | 'createdAt' | 'updatedAt'>
): AppSchedule {
  const now = Date.now()
  const schedule: AppSchedule = {
    ...data,
    id: randomUUID(),
    createdAt: now,
    updatedAt: now
  }
  const schedules = listAppSchedules()
  schedules.push(schedule)
  appScheduleStore.set('schedules', schedules)
  return schedule
}

export function updateAppSchedule(
  id: string,
  updates: Partial<Omit<AppSchedule, 'id' | 'createdAt'>>
): AppSchedule | undefined {
  const schedules = listAppSchedules()
  const idx = schedules.findIndex((s) => s.id === id)
  if (idx === -1) return undefined
  schedules[idx] = { ...schedules[idx], ...updates, updatedAt: Date.now() }
  appScheduleStore.set('schedules', schedules)
  return schedules[idx]
}

export function deleteAppSchedule(id: string): boolean {
  const schedules = listAppSchedules()
  const filtered = schedules.filter((s) => s.id !== id)
  if (filtered.length === schedules.length) return false
  appScheduleStore.set('schedules', filtered)
  return true
}

export function deleteAppScheduleByApp(appId: string): boolean {
  const schedules = listAppSchedules()
  const filtered = schedules.filter((s) => s.appId !== appId)
  if (filtered.length === schedules.length) return false
  appScheduleStore.set('schedules', filtered)
  return true
}

export function setAppScheduleEnabled(id: string, enabled: boolean): AppSchedule | undefined {
  return updateAppSchedule(id, { enabled })
}

/**
 * Upsert a schedule for an app. There is at most one schedule per appId, so a
 * new schedule replaces the previous one (preserving lastRun tracking when the
 * rule itself is unchanged is not worth the complexity — callers pass full data).
 */
export function upsertAppSchedule(
  appId: string,
  data: Omit<AppSchedule, 'id' | 'appId' | 'createdAt' | 'updatedAt'>
): AppSchedule {
  const existing = getAppScheduleByApp(appId)
  if (existing) {
    const updated = updateAppSchedule(existing.id, data)
    return updated ?? existing
  }
  return createAppSchedule({ ...data, appId })
}

import { BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import {
  listAppSchedules,
  updateAppSchedule,
  AppSchedule
} from '../store/app-schedule.store'
import { getManifest, getSubAppPath } from './subapp.service'
import { getActiveWorkspace } from './workspace.service'
import {
  executeSubAppWithCallbacks,
  resolvePythonCommand
} from './python-runner.service'
import { getPythonSdkPath } from '../utils/paths'
import { computeNextRun } from '../utils/schedule-rule'
import * as logger from '../utils/logger'

let schedulerTimer: ReturnType<typeof setInterval> | null = null

/**
 * Start the app scheduler. Call once after app.whenReady().
 * Checks every 60 seconds if any enabled app schedule should run.
 */
export function initAppScheduler(): void {
  if (schedulerTimer) return

  const schedules = listAppSchedules()
  for (const schedule of schedules) {
    if (schedule.enabled && !schedule.nextRunAt) {
      const next = computeNextRun(schedule)
      if (next) {
        updateAppSchedule(schedule.id, { nextRunAt: next })
      }
    }
  }

  schedulerTimer = setInterval(() => {
    tick()
  }, 60_000)

  tick()

  logger.info('[AppScheduler] Initialized, checking every 60s')
}

export function stopAppScheduler(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer)
    schedulerTimer = null
  }
}

function tick(): void {
  const now = Date.now()
  const schedules = listAppSchedules()

  for (const schedule of schedules) {
    if (!schedule.enabled) continue
    if (!schedule.nextRunAt) continue

    if (schedule.endDate) {
      const endTime = new Date(schedule.endDate).getTime() + 24 * 60 * 60 * 1000
      if (now > endTime) {
        updateAppSchedule(schedule.id, { enabled: false })
        continue
      }
    }

    // Double-execution guard: skip if lastRunAt is within the same minute
    if (schedule.lastRunAt) {
      const lastMinute = Math.floor(schedule.lastRunAt / 60_000)
      const nowMinute = Math.floor(now / 60_000)
      if (lastMinute === nowMinute) continue
    }

    if (now >= schedule.nextRunAt) {
      executeAppSchedule(schedule).catch((err) => {
        logger.error(`[AppScheduler] Schedule for "${schedule.appName}" failed:`, err)
      })
    }
  }
}

/**
 * Execute a single scheduled app run (headless — no renderer required).
 */
export async function executeAppSchedule(schedule: AppSchedule): Promise<void> {
  logger.info(`[AppScheduler] Executing schedule for "${schedule.appName}" (${schedule.appId})`)

  const manifest = getManifest(schedule.appId)
  if (!manifest) {
    markRunResult(schedule, false, 'App manifest not found')
    return
  }
  const appPath = getSubAppPath(schedule.appId)
  if (!appPath) {
    markRunResult(schedule, false, 'App path not found')
    return
  }

  const workspace = getActiveWorkspace()
  if (!workspace) {
    markRunResult(schedule, false, 'No active workspace selected')
    return
  }

  let pythonPath: string
  try {
    pythonPath = (await resolvePythonCommand()).path
  } catch (err: any) {
    markRunResult(schedule, false, `Python not available: ${err?.message || err}`)
    return
  }

  const sdkPath = getPythonSdkPath()
  const taskId = randomUUID()

  // Hold the schedule id in a closure so the async completion callback (which
  // only receives success/summary) can update the right record.
  const scheduleId = schedule.id
  const appId = schedule.appId
  const appName = schedule.appName
  const repeatRule = schedule.repeatRule

  executeSubAppWithCallbacks(
    taskId,
    appId,
    appName,
    manifest.version,
    appPath,
    manifest.entry,
    schedule.params || {},
    workspace as any,
    pythonPath,
    sdkPath,
    {
      onComplete: (success, summary) => {
        markRunResultById(scheduleId, repeatRule, success, summary)
        broadcastAppScheduleExecuted({
          scheduleId,
          appId,
          appName,
          status: success ? 'success' : 'error',
          summary,
          timestamp: Date.now()
        })
      }
    }
  )
}

function markRunResult(
  schedule: AppSchedule,
  success: boolean,
  summary: string
): void {
  markRunResultById(schedule.id, schedule.repeatRule, success, summary)
  broadcastAppScheduleExecuted({
    scheduleId: schedule.id,
    appId: schedule.appId,
    appName: schedule.appName,
    status: success ? 'success' : 'error',
    summary,
    timestamp: Date.now()
  })
}

function markRunResultById(
  scheduleId: string,
  repeatRule: AppSchedule['repeatRule'],
  success: boolean,
  summary: string
): void {
  const existing = listAppSchedules().find((s) => s.id === scheduleId)
  if (!existing) return
  const nextRun =
    repeatRule === 'none' ? undefined : computeNextRun(existing, Date.now() + 60_000) ?? undefined
  updateAppSchedule(scheduleId, {
    lastRunAt: Date.now(),
    lastRunStatus: success ? 'success' : 'error',
    lastRunSummary: summary,
    nextRunAt: nextRun,
    // Disable one-shot schedules after execution
    ...(repeatRule === 'none' ? { enabled: false } : {})
  })
}

function broadcastAppScheduleExecuted(data: {
  scheduleId: string
  appId: string
  appName: string
  status: string
  summary: string
  timestamp: number
}): void {
  const windows = BrowserWindow.getAllWindows()
  for (const win of windows) {
    if (!win.isDestroyed()) {
      win.webContents.send('app-schedule:executed', data)
    }
  }
}

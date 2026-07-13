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
 * Execute a single scheduled app run.
 *
 * Runs headlessly (no WebContents), but mirrors the interactive run's
 * `subapp:*` events to every window so the scheduled execution shows up in the
 * bottom output panel — marked as a scheduled run via `scheduled: true` and a
 * `⏰ 定时执行` announcement line.
 */
export async function executeAppSchedule(schedule: AppSchedule): Promise<void> {
  logger.info(`[AppScheduler] Executing schedule for "${schedule.appName}" (${schedule.appId})`)

  const { appId, appName } = schedule
  const taskId = randomUUID()

  // Surface the run in the bottom output panel (same channel as manual runs),
  // flagged as scheduled so the renderer marks it and can avoid stealing focus.
  sendToAllWindows('subapp:task-started', { taskId, appId, appName, scheduled: true })
  sendToAllWindows('subapp:output', {
    taskId,
    type: 'output',
    level: 'info',
    message: `⏰ 定时执行：${appName}`,
    timestamp: Date.now()
  })

  const manifest = getManifest(appId)
  if (!manifest) {
    finishScheduled(taskId, schedule, false, 'App manifest not found')
    return
  }
  const appPath = getSubAppPath(appId)
  if (!appPath) {
    finishScheduled(taskId, schedule, false, 'App path not found')
    return
  }

  const workspace = getActiveWorkspace()
  if (!workspace) {
    finishScheduled(taskId, schedule, false, 'No active workspace selected')
    return
  }

  let pythonPath: string
  try {
    pythonPath = (await resolvePythonCommand()).path
  } catch (err: any) {
    finishScheduled(taskId, schedule, false, `Python not available: ${err?.message || err}`)
    return
  }

  const sdkPath = getPythonSdkPath()

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
      onOutput: (message, level) => {
        sendToAllWindows('subapp:output', {
          taskId,
          type: 'output',
          message,
          level,
          timestamp: Date.now()
        })
      },
      onProgress: (percent, message) => {
        sendToAllWindows('subapp:progress', {
          taskId,
          type: 'progress',
          percent,
          message,
          timestamp: Date.now()
        })
      },
      onComplete: (success, summary) => {
        finishScheduled(taskId, schedule, success, summary)
      }
    }
  )
}

/**
 * Finalize a scheduled run: push a result banner to the output panel, update
 * schedule tracking, and broadcast a badge-refresh event.
 */
function finishScheduled(
  taskId: string,
  schedule: AppSchedule,
  success: boolean,
  summary: string
): void {
  sendToAllWindows('subapp:task-status', {
    taskId,
    status: success ? 'completed' : 'failed',
    success,
    summary,
    timestamp: Date.now()
  })

  const existing = listAppSchedules().find((s) => s.id === schedule.id)
  if (existing) {
    const nextRun =
      schedule.repeatRule === 'none'
        ? undefined
        : computeNextRun(existing, Date.now() + 60_000) ?? undefined
    updateAppSchedule(schedule.id, {
      lastRunAt: Date.now(),
      lastRunStatus: success ? 'success' : 'error',
      lastRunSummary: summary,
      nextRunAt: nextRun,
      // Disable one-shot schedules after execution
      ...(schedule.repeatRule === 'none' ? { enabled: false } : {})
    })
  }

  broadcastAppScheduleExecuted({
    scheduleId: schedule.id,
    appId: schedule.appId,
    appName: schedule.appName,
    status: success ? 'success' : 'error',
    summary,
    timestamp: Date.now()
  })
}

function sendToAllWindows(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload)
    }
  }
}

function broadcastAppScheduleExecuted(data: {
  scheduleId: string
  appId: string
  appName: string
  status: string
  summary: string
  timestamp: number
}): void {
  sendToAllWindows('app-schedule:executed', data)
}

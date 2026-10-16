import { BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import {
  listAppSchedules,
  updateAppSchedule,
  deleteAppSchedule,
  AppSchedule
} from '../store/app-schedule.store'
import { getManifest, getSubAppPath } from './subapp.service'
import { getActiveWorkspace } from './workspace.service'
import { executeSubAppWithCallbacks } from './python-runner.service'
import { prepareSubAppRun } from './subapp-run.service'
import { getPythonSdkPath } from '../utils/paths'
import { computeNextRun } from '../utils/schedule-rule'
import * as logger from '../utils/logger'

let schedulerTimer: NodeJS.Timeout | null = null

/** Active schedules and app IDs currently in-flight to prevent concurrent duplicate executions. */
const runningScheduleIds = new Set<string>()
const runningAppIds = new Set<string>()

export function isAppScheduleRunning(scheduleId: string, appId?: string): boolean {
  return runningScheduleIds.has(scheduleId) || (!!appId && runningAppIds.has(appId))
}

/**
 * Start the app scheduler. Call once after app.whenReady().
 * Checks every 60 seconds if any enabled app schedule should run.
 */
export function initAppScheduler(): void {
  if (schedulerTimer) return

  // Deduplicate any historical dirty data in store: keep the first entry per appId
  const schedules = listAppSchedules()
  const seenAppIds = new Set<string>()
  for (const schedule of schedules) {
    if (seenAppIds.has(schedule.appId)) {
      logger.warn(`[AppScheduler] Removing duplicate schedule entry ${schedule.id} for appId "${schedule.appId}"`)
      deleteAppSchedule(schedule.id)
    } else {
      seenAppIds.add(schedule.appId)
    }
  }

  const freshSchedules = listAppSchedules()
  for (const schedule of freshSchedules) {
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
  runningScheduleIds.clear()
  runningAppIds.clear()
}

function tick(): void {
  const now = Date.now()
  const schedules = listAppSchedules()
  const seenAppIds = new Set<string>()

  for (const schedule of schedules) {
    if (!schedule.enabled) continue
    if (!schedule.nextRunAt) continue

    // Guard against duplicate appId entries in the same cycle
    if (seenAppIds.has(schedule.appId)) {
      logger.warn(`[AppScheduler] Duplicate schedule entry detected for appId "${schedule.appId}", skipping`)
      continue
    }
    seenAppIds.add(schedule.appId)

    if (schedule.endDate) {
      const endTime = new Date(schedule.endDate).getTime() + 24 * 60 * 60 * 1000
      if (now > endTime) {
        updateAppSchedule(schedule.id, { enabled: false })
        continue
      }
    }

    // In-flight guard: skip if this schedule or app is currently running
    if (runningScheduleIds.has(schedule.id) || runningAppIds.has(schedule.appId)) {
      logger.debug(`[AppScheduler] Schedule "${schedule.appName}" is currently running, skipping tick`)
      continue
    }

    // Double-execution guard: skip if lastRunAt was within 55s or in the exact same minute
    if (schedule.lastRunAt) {
      if (now - schedule.lastRunAt < 55_000) continue
      const lastMinute = Math.floor(schedule.lastRunAt / 60_000)
      const nowMinute = Math.floor(now / 60_000)
      if (lastMinute === nowMinute) continue
    }

    if (now >= schedule.nextRunAt) {
      // Advance nextRunAt and record lastRunAt immediately upon triggering to prevent
      // subsequent ticks from re-triggering this task while it runs
      const nextRun =
        schedule.repeatRule === 'none'
          ? undefined
          : computeNextRun(schedule, now + 60_000) ?? undefined

      updateAppSchedule(schedule.id, {
        lastRunAt: now,
        nextRunAt: nextRun,
        ...(schedule.repeatRule === 'none' ? { enabled: false } : {})
      })

      // Mark as in-flight before spawning process
      runningScheduleIds.add(schedule.id)
      runningAppIds.add(schedule.appId)

      startScheduledExecution(schedule).catch((err: unknown) => {
        logger.error(`[AppScheduler] Schedule for "${schedule.appName}" failed:`, err)
        runningScheduleIds.delete(schedule.id)
        runningAppIds.delete(schedule.appId)
        const msg = err instanceof Error ? err.message : String(err)
        updateAppSchedule(schedule.id, {
          lastRunStatus: 'error',
          lastRunSummary: msg || 'Execution start failed'
        })
      })
    }
  }
}

/**
 * Execute a single scheduled app run manually (e.g. from run-now IPC).
 * Rejects if the schedule is already running.
 */
export async function executeAppSchedule(schedule: AppSchedule): Promise<void> {
  if (runningScheduleIds.has(schedule.id) || runningAppIds.has(schedule.appId)) {
    throw new Error(`Schedule "${schedule.appName}" is already running`)
  }

  runningScheduleIds.add(schedule.id)
  runningAppIds.add(schedule.appId)

  updateAppSchedule(schedule.id, {
    lastRunAt: Date.now()
  })

  return startScheduledExecution(schedule)
}

/**
 * Launch the subapp process and wire up streaming output and lifecycle callbacks.
 *
 * Runs headlessly (no WebContents), but mirrors the interactive run's
 * `subapp:*` events to every window so the scheduled execution shows up in the
 * bottom output panel — marked as a scheduled run via `scheduled: true` and a
 * `⏰ 定时执行` announcement line.
 */
async function startScheduledExecution(schedule: AppSchedule): Promise<void> {
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

  try {
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

    // Shared pre-run pipeline (builtin kill-switch, reserved-key stripping,
    // Python + requirements); progress lines go to the output panel.
    const prep = await prepareSubAppRun(
      { appId, appName: manifest.name || appName, appPath },
      schedule.params || {},
      (message, level) =>
        sendToAllWindows('subapp:output', {
          taskId,
          type: 'output',
          message,
          level,
          timestamp: Date.now()
        })
    )
    if (!prep.ok) {
      finishScheduled(
        taskId,
        schedule,
        false,
        prep.stage === 'python' ? `Python not available: ${prep.message}` : prep.message
      )
      return
    }
    const pythonPath = prep.python.path

    const sdkPath = getPythonSdkPath()

    executeSubAppWithCallbacks(
      taskId,
      appId,
      appName,
      manifest.version,
      appPath,
      manifest.entry,
      prep.params,
      workspace as unknown as Parameters<typeof executeSubAppWithCallbacks>[7],
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
        onComplete: (success, summary, cancelled) => {
          finishScheduled(taskId, schedule, success, summary, cancelled)
        }
      }
    )
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.error(`[AppScheduler] Execution start failed for "${appName}":`, err)
    finishScheduled(taskId, schedule, false, msg || 'Execution start failed')
  }
}

/**
 * Finalize a scheduled run: push a result banner to the output panel, update
 * schedule tracking, and broadcast a badge-refresh event.
 */
function finishScheduled(
  taskId: string,
  schedule: AppSchedule,
  success: boolean,
  summary: string,
  cancelled?: boolean
): void {
  try {
    sendToAllWindows('subapp:task-status', {
      taskId,
      status: cancelled ? 'cancelled' : success ? 'completed' : 'failed',
      success: cancelled ? false : success,
      cancelled: !!cancelled,
      summary,
      summaryI18nKey: cancelled ? 'subapp.executionCancelled' : undefined,
      timestamp: Date.now()
    })

    const existing = listAppSchedules().find((s) => s.id === schedule.id)
    if (existing) {
      // Fallback: if nextRunAt was somehow not populated and repeat rule is active, recompute
      let nextRun = existing.nextRunAt
      if (!nextRun && existing.repeatRule !== 'none') {
        nextRun = computeNextRun(existing, Date.now() + 60_000) ?? undefined
      }
      updateAppSchedule(schedule.id, {
        lastRunStatus: success ? 'success' : 'error',
        lastRunSummary: summary,
        ...(nextRun !== existing.nextRunAt ? { nextRunAt: nextRun } : {})
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
  } finally {
    runningScheduleIds.delete(schedule.id)
    runningAppIds.delete(schedule.appId)
  }
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

import { BrowserWindow } from 'electron'
import {
  listScheduledTasks,
  updateScheduledTask,
  ScheduledTask
} from '../store/scheduled-task.store'
import { completeChat, ChatMessage } from './ai.service'
import { getIMBridgeService } from './im/im-bridge.service'
import * as logger from '../utils/logger'

let schedulerTimer: ReturnType<typeof setInterval> | null = null

/**
 * Start the scheduler. Call once after app.whenReady().
 * Checks every 60 seconds if any enabled tasks should run.
 */
export function initScheduler(): void {
  if (schedulerTimer) return

  // Compute initial nextRunAt for all tasks
  const tasks = listScheduledTasks()
  for (const task of tasks) {
    if (task.enabled && !task.nextRunAt) {
      const next = computeNextRun(task)
      if (next) {
        updateScheduledTask(task.id, { nextRunAt: next })
      }
    }
  }

  schedulerTimer = setInterval(() => {
    tick()
  }, 60_000)

  // Also run once immediately
  tick()

  logger.info('[Scheduler] Initialized, checking every 60s')
}

export function stopScheduler(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer)
    schedulerTimer = null
  }
}

function tick(): void {
  const now = Date.now()
  const tasks = listScheduledTasks()

  for (const task of tasks) {
    if (!task.enabled) continue
    if (!task.nextRunAt) continue

    // Check if end date has passed
    if (task.endDate) {
      const endTime = new Date(task.endDate).getTime() + 24 * 60 * 60 * 1000 // end of day
      if (now > endTime) {
        updateScheduledTask(task.id, { enabled: false })
        continue
      }
    }

    // Double-execution guard: skip if lastRunAt is within the same minute
    if (task.lastRunAt) {
      const lastMinute = Math.floor(task.lastRunAt / 60_000)
      const nowMinute = Math.floor(now / 60_000)
      if (lastMinute === nowMinute) continue
    }

    if (now >= task.nextRunAt) {
      executeTask(task).catch((err) => {
        logger.error(`[Scheduler] Task "${task.name}" execution failed:`, err)
      })
    }
  }
}

/**
 * Compute the next run timestamp for a task based on its schedule.
 */
export function computeNextRun(task: ScheduledTask, fromTime?: number): number | null {
  const now = fromTime ?? Date.now()
  const [hours, minutes] = task.time.split(':').map(Number)

  if (task.repeatRule === 'none') {
    // One-shot: find next occurrence of the specified time today or tomorrow
    const today = new Date(now)
    today.setHours(hours, minutes, 0, 0)
    if (today.getTime() > now) return today.getTime()
    today.setDate(today.getDate() + 1)
    return today.getTime()
  }

  if (task.repeatRule === 'daily') {
    const next = new Date(now)
    next.setHours(hours, minutes, 0, 0)
    if (next.getTime() <= now) {
      next.setDate(next.getDate() + 1)
    }
    return next.getTime()
  }

  if (task.repeatRule === 'weekly') {
    const targetDay = task.dayOfWeek ?? 0
    const next = new Date(now)
    next.setHours(hours, minutes, 0, 0)
    const currentDay = next.getDay()
    let daysUntil = targetDay - currentDay
    if (daysUntil < 0 || (daysUntil === 0 && next.getTime() <= now)) {
      daysUntil += 7
    }
    next.setDate(next.getDate() + daysUntil)
    return next.getTime()
  }

  if (task.repeatRule === 'monthly') {
    const targetDate = task.dayOfMonth ?? 1
    const next = new Date(now)
    next.setHours(hours, minutes, 0, 0)
    next.setDate(targetDate)
    if (next.getTime() <= now) {
      next.setMonth(next.getMonth() + 1)
      next.setDate(targetDate)
    }
    return next.getTime()
  }

  return null
}

/**
 * Execute a single scheduled task.
 */
export async function executeTask(task: ScheduledTask): Promise<void> {
  logger.info(`[Scheduler] Executing task "${task.name}" (${task.id})`)

  const configId = task.modelConfigId || ''
  const messages: ChatMessage[] = [
    { role: 'user', content: task.prompt }
  ]

  let resultText = ''
  let status: 'success' | 'error' = 'success'

  try {
    resultText = await completeChat(configId, messages, task.modelId, 4096)
  } catch (err: any) {
    status = 'error'
    resultText = err.message || 'Unknown error'
    logger.error(`[Scheduler] Task "${task.name}" AI call failed:`, err)
  }

  // Update task tracking
  const nextRun = task.repeatRule === 'none' ? undefined : computeNextRun(task, Date.now() + 60_000)
  updateScheduledTask(task.id, {
    lastRunAt: Date.now(),
    lastRunStatus: status,
    nextRunAt: nextRun,
    // Disable one-shot tasks after execution
    ...(task.repeatRule === 'none' ? { enabled: false } : {})
  })

  // Broadcast to renderer (includes info for conversation creation)
  broadcastTaskExecuted({
    taskId: task.id,
    taskName: task.name,
    status,
    result: resultText,
    prompt: task.prompt,
    keepInOneChat: task.keepInOneChat,
    conversationId: task.conversationId,
    timestamp: Date.now()
  })

  // IM notification
  if (task.imNotifyEnabled && status === 'success') {
    sendIMNotification(task.name, resultText)
  }
}

function broadcastTaskExecuted(data: {
  taskId: string
  taskName: string
  status: string
  result: string
  prompt: string
  keepInOneChat: boolean
  conversationId?: string
  timestamp: number
}): void {
  const windows = BrowserWindow.getAllWindows()
  for (const win of windows) {
    win.webContents.send('scheduled-task:executed', data)
  }
}

function sendIMNotification(taskName: string, result: string): void {
  try {
    const bridge = getIMBridgeService()
    const connectionStatus = bridge.getConnectionStatus()
    if (connectionStatus.state !== 'connected') return

    // Get the first available chat to send notification
    const chatStates = (bridge as any).chatStates as Map<string, any> | undefined
    if (!chatStates || chatStates.size === 0) return

    const firstChatId = chatStates.keys().next().value
    if (!firstChatId) return

    const summary = result.length > 500 ? result.substring(0, 500) + '...' : result
    const message = `📋 定时任务完成: ${taskName}\n\n${summary}`
    ;(bridge as any).adapter?.sendText(firstChatId, message)
  } catch (err) {
    logger.error('[Scheduler] Failed to send IM notification:', err)
  }
}

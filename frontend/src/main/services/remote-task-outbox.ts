/**
 * Durable outbox for remote task reports.
 *
 * Terminal reports (SUCCESS / FAILED / SKIPPED / …) are persisted before being
 * sent so a network blip or app restart never loses the result; they are
 * replayed on the next pull. The in-flight marker lets a crashed run be
 * reported as FAILED · CLIENT_RESTARTED after restart.
 */
import Store from 'electron-store'
import * as logger from '../utils/logger'
import { getApiToken } from '../store/api-credentials.store'
import { getMachineId } from '../store/machine.store'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api/v1'
const MAX_OUTBOX_AGE_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
const MAX_OUTBOX_ITEMS = 500

export interface TaskReportData {
  status: 'SUCCESS' | 'FAILED' | 'CANCELLED' | 'REJECTED' | 'SKIPPED'
  reasonCode?: string | null
  exitCode?: number | null
  durationMs?: number | null
  summary?: string | null
  logExcerpt?: string | null
}

interface OutboxItem {
  id: string
  taskId: string
  data: TaskReportData
  enqueuedAt: number
}

interface InFlightInfo {
  taskId: string
  startedAt: number
}

interface RemoteTaskOutboxSchema {
  inFlight: InFlightInfo | null
  items: OutboxItem[]
}

const outboxStore = new Store<RemoteTaskOutboxSchema>({
  name: 'remote-task-outbox',
  schema: {
    inFlight: {
      type: ['object', 'null'],
      default: null,
      properties: {
        taskId: { type: 'string' },
        startedAt: { type: 'number' }
      }
    },
    items: {
      type: 'array',
      default: []
    }
  }
})

export function setInFlight(taskId: string, startedAt: number): void {
  outboxStore.set('inFlight', { taskId, startedAt })
}

export function clearInFlight(taskId?: string): void {
  const current = outboxStore.get('inFlight')
  if (!taskId || current?.taskId === taskId) {
    outboxStore.set('inFlight', null)
  }
}

export function getInFlight(): InFlightInfo | null {
  return outboxStore.get('inFlight')
}

/** A run that was in flight when the app died is reported as failed. */
export function recoverInFlight(): void {
  const current = getInFlight()
  if (current?.taskId) {
    logger.warn(`[RemoteTask] Recovering interrupted in-flight task: ${current.taskId}`)
    enqueueReport(current.taskId, {
      status: 'FAILED',
      reasonCode: 'CLIENT_RESTARTED',
      summary: 'Task interrupted due to unexpected client restart'
    })
    clearInFlight(current.taskId)
  }
}

export function enqueueReport(taskId: string, data: TaskReportData): void {
  const items = outboxStore.get('items') || []
  items.push({
    id: `${taskId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    taskId,
    data,
    enqueuedAt: Date.now()
  })
  outboxStore.set('items', items.slice(-MAX_OUTBOX_ITEMS))
  void flushOutbox()
}

let isFlushing = false

export async function flushOutbox(): Promise<void> {
  if (isFlushing) return
  const token = getApiToken()
  if (!token) return

  isFlushing = true
  try {
    const now = Date.now()
    const items = (outboxStore.get('items') || []).filter(
      (item) => now - item.enqueuedAt <= MAX_OUTBOX_AGE_MS
    )
    const delivered = new Set<string>()
    const machineId = getMachineId()

    for (const item of items) {
      try {
        const resp = await fetch(
          `${API_BASE_URL}/client/tasks/${encodeURIComponent(item.taskId)}/report`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              machineId,
              status: item.data.status,
              reasonCode: item.data.reasonCode ?? null,
              exitCode: item.data.exitCode ?? null,
              durationMs: item.data.durationMs ?? null,
              summary: item.data.summary ?? null,
              logExcerpt: item.data.logExcerpt ?? null
            }),
            signal: AbortSignal.timeout(10_000)
          }
        )
        // 2xx delivered; 400/404/409/410 = permanently rejected (never retry).
        // 401, 429, 5xx → keep for retry.
        if (resp.ok || [400, 404, 409, 410].includes(resp.status)) {
          delivered.add(item.id)
          logger.debug(`[RemoteTask] Outbox report for ${item.taskId} done (HTTP ${resp.status})`)
        }
      } catch {
        // network error / timeout → retry later
      }
    }

    // Re-read so reports enqueued while flushing are not lost.
    const latest = (outboxStore.get('items') || []).filter(
      (item) => !delivered.has(item.id) && now - item.enqueuedAt <= MAX_OUTBOX_AGE_MS
    )
    outboxStore.set('items', latest)
  } catch (err) {
    logger.warn('[RemoteTask] flushOutbox error:', err)
  } finally {
    isFlushing = false
  }
}

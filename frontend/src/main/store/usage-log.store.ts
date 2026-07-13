import Store from 'electron-store'

/**
 * Local audit log of app download / execution events.
 *
 * This is purely a local record + a retry queue for execution reports that
 * failed to upload (e.g. offline). It is never surfaced in any UI — see
 * CLAUDE.md decision: "本地记录仅作为上传前的内部队列，不做 UI".
 */

export type UsageEventType = 'download' | 'execution'

export interface UsageEvent {
  id: string
  type: UsageEventType
  applicationId: string
  version?: string
  success?: boolean
  errorMessage?: string
  errorDetails?: string
  timestamp: number
  /** Only meaningful for type === 'execution'. Download events never need a network call. */
  uploaded?: boolean
}

interface UsageLogSchema {
  events: UsageEvent[]
}

/** Hard cap on stored events to keep the local store file small. */
const MAX_EVENTS = 200
/** Pending execution events older than this are dropped instead of retried forever. */
const MAX_PENDING_AGE_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

const usageLogStore = new Store<UsageLogSchema>({
  name: 'usage-log',
  schema: {
    events: {
      type: 'array',
      default: []
    }
  }
})

export function appendEvent(event: UsageEvent): void {
  const events = usageLogStore.get('events', [])
  events.push(event)
  // Keep only the most recent MAX_EVENTS entries.
  const trimmed = events.length > MAX_EVENTS ? events.slice(events.length - MAX_EVENTS) : events
  usageLogStore.set('events', trimmed)
}

/** Pending (not yet successfully uploaded) execution events, oldest first. */
export function getPendingExecutionEvents(): UsageEvent[] {
  return usageLogStore
    .get('events', [])
    .filter((e) => e.type === 'execution' && !e.uploaded)
}

export function markUploaded(id: string): void {
  const events = usageLogStore.get('events', [])
  const idx = events.findIndex((e) => e.id === id)
  if (idx === -1) return
  events[idx] = { ...events[idx], uploaded: true }
  usageLogStore.set('events', events)
}

/** Drop pending execution events older than MAX_PENDING_AGE_MS so the queue never grows unbounded. */
export function pruneOldPendingEvents(): void {
  const now = Date.now()
  const events = usageLogStore.get('events', [])
  const kept = events.filter((e) => {
    if (e.type !== 'execution' || e.uploaded) return true
    return now - e.timestamp <= MAX_PENDING_AGE_MS
  })
  if (kept.length !== events.length) {
    usageLogStore.set('events', kept)
  }
}

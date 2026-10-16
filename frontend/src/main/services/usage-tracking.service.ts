import { randomUUID } from 'crypto'
import { getApiToken } from '../store/api-credentials.store'
import { appendEvent, getPendingExecutionEvents, markUploaded, pruneOldPendingEvents } from '../store/usage-log.store'
import * as logger from '../utils/logger'

/**
 * Local download/execution usage tracking + best-effort upload when the user
 * is logged in (see CLAUDE.md decision log for this feature).
 *
 * - Downloads: the marketplace download itself already hits the backend
 *   (GET /applications/:id/download), which increments download_count
 *   server-side regardless of login state. So `recordDownloadEvent` only
 *   writes a local audit entry — no network call needed here.
 * - Executions: purely local (spawns a Python process), so the server has
 *   zero visibility unless the client reports it. `recordExecutionResult`
 *   always writes a local entry, and additionally POSTs to the backend when
 *   an API token is present (i.e. the user is logged in; local-mode/anonymous
 *   users never have a token here, so they're silently skipped).
 */

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api/v1'

/**
 * Builtin apps live in the common_apps table (keyed by app_key), not the
 * marketplace applications table, so their run/error reports go to a different
 * endpoint. Their manifest id is always `${BUILTIN_APP_ID_PREFIX}${appKey}`.
 */
const BUILTIN_APP_ID_PREFIX = 'com.clawbench.builtin.'

const MAX_MESSAGE_LENGTH = 4000
const MAX_DETAILS_LENGTH = 20000

function truncate(value: string | undefined, maxLength: number): string | undefined {
  if (!value) return undefined
  return value.length > maxLength ? value.slice(0, maxLength) : value
}

/** Local-only record of a marketplace download/update. No network call — see module doc. */
export function recordDownloadEvent(applicationId: string, version?: string): void {
  try {
    appendEvent({
      id: randomUUID(),
      type: 'download',
      applicationId,
      version,
      timestamp: Date.now()
    })
  } catch (err) {
    logger.warn('Failed to record local download event:', err)
  }
}

async function uploadExecutionEvent(event: {
  id: string
  applicationId: string
  version?: string
  success: boolean
  cancelled?: boolean
  errorMessage?: string
  errorDetails?: string
}): Promise<boolean> {
  const token = getApiToken()
  if (!token) return false // not logged in (or local mode) — nothing to upload

  const isBuiltin = event.applicationId.startsWith(BUILTIN_APP_ID_PREFIX)
  const url = isBuiltin
    ? `${API_BASE_URL}/common-apps/${encodeURIComponent(
        event.applicationId.slice(BUILTIN_APP_ID_PREFIX.length)
      )}/executions`
    : `${API_BASE_URL}/applications/${encodeURIComponent(event.applicationId)}/executions`

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        version: event.version,
        // Cancelled runs are never successes; force flags so backend never
        // writes an error row even if a stale pending event is incomplete.
        success: event.cancelled ? false : event.success,
        cancelled: event.cancelled === true,
        errorMessage: event.cancelled
          ? undefined
          : truncate(event.errorMessage, MAX_MESSAGE_LENGTH),
        errorDetails: event.cancelled
          ? undefined
          : truncate(event.errorDetails, MAX_DETAILS_LENGTH)
      })
    })
    return res.ok
  } catch (err) {
    logger.warn(`Failed to upload execution result for ${event.applicationId}:`, err)
    return false
  }
}

/**
 * Records the result of running an `app`-type sub-app locally, and uploads it
 * to the backend when the user is logged in. Safe to call multiple times per
 * task as long as callers only invoke it once per completed task (the three
 * call sites in python-runner.service.ts each already guard against firing
 * more than once for the same task).
 */
export async function recordExecutionResult(
  applicationId: string,
  version: string | undefined,
  success: boolean,
  errorMessage?: string,
  cancelled?: boolean,
  errorDetails?: string
): Promise<void> {
  const id = randomUUID()

  try {
    appendEvent({
      id,
      type: 'execution',
      applicationId,
      version,
      success,
      cancelled,
      errorMessage: truncate(errorMessage, MAX_MESSAGE_LENGTH),
      errorDetails: truncate(errorDetails, MAX_DETAILS_LENGTH),
      timestamp: Date.now(),
      uploaded: false
    })
  } catch (err) {
    logger.warn('Failed to record local execution event:', err)
  }

  const uploaded = await uploadExecutionEvent({
    id,
    applicationId,
    version,
    success,
    cancelled,
    errorMessage,
    errorDetails
  })

  if (uploaded) {
    try {
      markUploaded(id)
    } catch (err) {
      logger.warn('Failed to mark execution event as uploaded:', err)
    }
  }
}

/**
 * Reports a builtin app install/upgrade to the backend so its download_count
 * reflects real client rollout. Builtin apps are seeded locally (never go
 * through the marketplace download endpoint), so without this their
 * download_count would stay at 0. Best-effort: silently skipped when the user
 * is not logged in, and failures are swallowed (a local audit entry is still
 * written).
 *
 * @param appKey builtin app key (e.g. "env-check")
 * @param version bundled manifest version
 */
export async function reportBuiltinAppInstall(appKey: string, version?: string): Promise<void> {
  try {
    appendEvent({
      id: randomUUID(),
      type: 'download',
      applicationId: `${BUILTIN_APP_ID_PREFIX}${appKey}`,
      version,
      timestamp: Date.now()
    })
  } catch (err) {
    logger.warn('Failed to record local builtin install event:', err)
  }

  const token = getApiToken()
  if (!token) return

  try {
    await fetch(`${API_BASE_URL}/common-apps/${encodeURIComponent(appKey)}/downloads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ version })
    })
  } catch (err) {
    logger.warn(`Failed to report builtin install for ${appKey}:`, err)
  }
}

/**
 * Retries any execution reports that failed to upload previously (e.g. the
 * user was offline). Call once at app startup. No-op when there's no token
 * (not logged in) or nothing pending.
 */
export async function flushPendingUsageEvents(): Promise<void> {
  try {
    pruneOldPendingEvents()
  } catch (err) {
    logger.warn('Failed to prune old usage events:', err)
  }

  const token = getApiToken()
  if (!token) return

  const pending = getPendingExecutionEvents()
  if (pending.length === 0) return

  logger.info(`Flushing ${pending.length} pending execution report(s)...`)

  for (const event of pending) {
    const uploaded = await uploadExecutionEvent({
      id: event.id,
      applicationId: event.applicationId,
      version: event.version,
      success: !!event.success,
      cancelled: event.cancelled,
      errorMessage: event.errorMessage,
      errorDetails: event.errorDetails
    })
    if (uploaded) {
      markUploaded(event.id)
    }
  }
}

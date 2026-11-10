/**
 * Remote task dispatch — desktop side (see docs/REMOTE_TASK_DISPATCH.md).
 *
 * An admin dispatches "run app X@version with these params" from the web
 * admin panel. While logged in, the client keeps an SSE stream to the server
 * (`/client/events`) that only carries "there is a new task" signals; the task
 * itself is pulled over an authenticated request, claimed per machine, and
 * executed through the shared sub-app run pipeline (`subapp-run.service`:
 * reserved `__` keys stripped, builtin kill-switch, project config injection).
 *
 * Trust model: by default (`always-confirm`) every task waits for the user to
 * review and confirm it. `silent` mode runs already-installed apps without a
 * prompt (still with a system notification and a "Remote" badge); installs /
 * upgrades always need confirmation. `disabled` refuses all tasks.
 */
import { BrowserWindow, Notification } from 'electron'
import { randomUUID } from 'crypto'
import * as logger from '../utils/logger'
import { mainT } from '../utils/i18n'
import { getApiToken } from '../store/api-credentials.store'
import { getMachineId } from '../store/machine.store'
import { getRemoteTaskMode } from '../store/settings.store'
import { getManifest, getSubAppPath } from './subapp.service'
import { getActiveWorkspace } from './workspace.service'
import { executeSubAppWithCallbacks, isAppRunning } from './python-runner.service'
import { prepareSubAppRun } from './subapp-run.service'
import { installMarketApp } from './im/marketplace.service'
import { getPythonSdkPath } from '../utils/paths'
import { enqueueReport, flushOutbox, recoverInFlight, setInFlight, clearInFlight } from './remote-task-outbox'
import { cleanOldRemoteTaskLogs, createTaskLogger } from './remote-task-logger'
import { needsConfirm, normalizeRemoteTask, planInstall, type RemoteTask } from './remote-task-rules'

export type { RemoteTask } from './remote-task-rules'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api/v1'

const POLL_INTERVAL_MS = 15 * 60_000
const POLL_JITTER_MS = 60_000
const SSE_RETRY_MIN_MS = 5_000
const SSE_RETRY_MAX_MS = 5 * 60_000
const SSE_IDLE_TIMEOUT_MS = 70_000 // server pings every 25s; 70s of silence = half-open socket
const SSE_STABLE_MS = 60_000 // connection must live this long before backoff resets
const HEARTBEAT_MS = 60_000
const SAME_APP_WAIT_MS = 30_000
const MAX_JITTER_MS = 30_000

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function sendToAllWindows(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

function notify(title: string, body: string): void {
  try {
    if (Notification.isSupported()) new Notification({ title, body }).show()
  } catch (err) {
    logger.warn('[RemoteTask] notification failed:', err)
  }
}

async function postJson(path: string, body: unknown, timeoutMs = 15_000): Promise<Response> {
  return fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getApiToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs)
  })
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

class RemoteTaskService {
  private active = false
  /** Bumped on every start()/stop(); async callbacks from an old session drop their results. */
  private generation = 0
  private sseAbort: AbortController | null = null
  private pollTimer: NodeJS.Timeout | null = null
  /** Tasks seen this session (queued / waiting / running / done) — prevents re-queueing. */
  private known = new Set<string>()
  private queue: RemoteTask[] = []
  private waiting = new Map<string, RemoteTask>()
  private processing = false
  private pulling = false
  private pullAgain = false

  /** Called at startup and after login; idempotent. No-op without a server token. */
  start(): void {
    if (this.active || !getApiToken()) return
    this.active = true
    const gen = ++this.generation
    cleanOldRemoteTaskLogs()
    recoverInFlight()
    void this.sseLoop(gen)
    void this.pull()
    this.schedulePoll(gen)
    logger.info(`[RemoteTask] Service started (gen=${gen})`)
  }

  /** Logout / quit. Running processes are not killed; their result still goes through the outbox. */
  stop(): void {
    if (!this.active && this.waiting.size === 0) return
    this.active = false
    this.generation++
    this.sseAbort?.abort()
    this.sseAbort = null
    if (this.pollTimer) clearTimeout(this.pollTimer)
    this.pollTimer = null
    this.queue = []
    this.waiting.clear()
    this.known.clear()
    this.notifyWaitingChanged()
    logger.info('[RemoteTask] Service stopped')
  }

  private isCurrent(gen: number): boolean {
    return this.active && gen === this.generation
  }

  private schedulePoll(gen: number): void {
    const delay = POLL_INTERVAL_MS + Math.random() * POLL_JITTER_MS
    this.pollTimer = setTimeout(() => {
      if (!this.isCurrent(gen)) return
      void this.pull()
      this.schedulePoll(gen)
    }, delay)
  }

  // ---- SSE ----

  private async sseLoop(gen: number): Promise<void> {
    let backoff = SSE_RETRY_MIN_MS
    while (this.isCurrent(gen)) {
      const abort = new AbortController()
      this.sseAbort = abort
      const connectedAt = Date.now()
      try {
        const resp = await fetch(`${API_BASE_URL}/client/events`, {
          headers: { Authorization: `Bearer ${getApiToken()}`, Accept: 'text/event-stream' },
          signal: abort.signal
        })
        if (resp.status === 401) backoff = SSE_RETRY_MAX_MS // token invalid: retry slowly, re-reading the token
        if (!resp.ok || !resp.body) throw new Error(`SSE HTTP ${resp.status}`)
        void this.pull() // catch up on anything missed while disconnected
        await this.readEvents(resp.body, abort)
      } catch (err) {
        if (!this.isCurrent(gen)) return
        logger.warn('[RemoteTask] SSE disconnected:', err instanceof Error ? err.message : err)
      }
      if (Date.now() - connectedAt > SSE_STABLE_MS) backoff = SSE_RETRY_MIN_MS
      await sleep(Math.random() * backoff) // full jitter avoids reconnect storms
      backoff = Math.min(backoff * 2, SSE_RETRY_MAX_MS)
    }
  }

  private async readEvents(body: ReadableStream<Uint8Array>, abort: AbortController): Promise<void> {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let idleTimer: NodeJS.Timeout | undefined
    const armIdle = (): void => {
      clearTimeout(idleTimer)
      idleTimer = setTimeout(() => abort.abort(), SSE_IDLE_TIMEOUT_MS)
    }
    try {
      armIdle()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) return
        armIdle()
        buffer += decoder.decode(value, { stream: true })
        let sep: number
        while ((sep = buffer.indexOf('\n\n')) >= 0) {
          this.handleFrame(buffer.slice(0, sep))
          buffer = buffer.slice(sep + 2)
        }
        if (buffer.length > 64 * 1024) buffer = '' // never buffer unbounded garbage
      }
    } finally {
      clearTimeout(idleTimer)
    }
  }

  private handleFrame(frame: string): void {
    let event = 'message'
    let data = ''
    for (const line of frame.split('\n')) {
      if (line.startsWith(':')) continue // heartbeat comment
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) data += line.slice(5).trim()
    }
    if (event !== 'NEW_TASK') return
    let jitterMs = 0
    try {
      jitterMs = Math.min(MAX_JITTER_MS, Math.max(0, Number(JSON.parse(data).jitterMs) || 0))
    } catch {
      // unparsable → no jitter
    }
    // The event is only a signal; the task itself is always pulled (authenticated).
    setTimeout(() => void this.pull(), Math.random() * jitterMs)
  }

  // ---- pull ----

  async pull(): Promise<void> {
    if (!this.active) return
    if (this.pulling) {
      this.pullAgain = true // coalesce concurrent triggers
      return
    }
    this.pulling = true
    this.pullAgain = false
    const gen = this.generation
    try {
      await flushOutbox() // replay undelivered reports first
      const resp = await postJson('/client/tasks/pull', { machineId: getMachineId() })
      if (!resp.ok) throw new Error(`pull HTTP ${resp.status}`)
      const body = (await resp.json()) as { success: boolean; data?: unknown[] }
      if (gen !== this.generation) return // session switched; drop
      const tasks: RemoteTask[] = []
      for (const raw of Array.isArray(body.data) ? body.data : []) {
        const task = normalizeRemoteTask(raw)
        if (task) tasks.push(task)
        else logger.warn('[RemoteTask] Ignoring malformed task from server')
      }
      this.reconcileWaiting(tasks)
      for (const task of tasks) {
        if (this.known.has(task.taskId)) continue
        this.known.add(task.taskId)
        this.queue.push(task)
      }
      void this.processQueue()
    } catch (err) {
      logger.warn('[RemoteTask] pull failed:', err instanceof Error ? err.message : err)
    } finally {
      this.pulling = false
      if (this.pullAgain) void this.pull()
    }
  }

  /** Drop locally-waiting tasks the server no longer returns (revoked / expired). */
  private reconcileWaiting(serverTasks: RemoteTask[]): void {
    const alive = new Set(serverTasks.map((t) => t.taskId))
    let changed = false
    for (const taskId of [...this.waiting.keys()]) {
      if (!alive.has(taskId)) {
        this.waiting.delete(taskId)
        changed = true
      }
    }
    if (changed) this.notifyWaitingChanged()
  }

  private notifyWaitingChanged(): void {
    // The renderer (RemoteTaskManager) raises the attention item / tray badge.
    sendToAllWindows('remoteTask:waiting-changed', this.listWaiting())
  }

  // ---- queue ----

  private async processQueue(): Promise<void> {
    if (this.processing) return
    this.processing = true
    try {
      while (this.active && this.queue.length > 0) {
        const task = this.queue.shift()!
        try {
          await this.handleTask(task)
        } catch (err) {
          logger.error(`[RemoteTask] task ${task.taskId} failed unexpectedly:`, err)
          enqueueReport(task.taskId, {
            status: 'FAILED',
            reasonCode: 'CLIENT_ERROR',
            summary: String(err)
          })
        }
      }
    } finally {
      this.processing = false
    }
  }

  /** The user confirmed in the renderer (possibly editing params): run it next. */
  confirm(taskId: string, params: unknown): boolean {
    const task = this.waiting.get(taskId)
    if (!task || !isPlainObject(params)) return false
    this.waiting.delete(taskId)
    this.notifyWaitingChanged()
    this.queue.unshift({ ...task, presetParams: params, confirmed: true })
    void this.processQueue()
    return true
  }

  reject(taskId: string): boolean {
    if (!this.waiting.delete(taskId)) return false
    this.notifyWaitingChanged()
    enqueueReport(taskId, { status: 'REJECTED' })
    return true
  }

  listWaiting(): RemoteTask[] {
    return Array.from(this.waiting.values())
  }

  private async handleTask(task: RemoteTask): Promise<void> {
    // 1. Local opt-out
    const mode = getRemoteTaskMode()
    if (mode === 'disabled') {
      logger.info(`[RemoteTask] Task ${task.taskId} skipped: disabled by user`)
      enqueueReport(task.taskId, {
        status: 'SKIPPED',
        reasonCode: 'DISABLED_BY_USER',
        summary: 'Remote tasks disabled by local user setting'
      })
      return
    }

    // 2. Install / version check (never downgrade). Installing waits for confirmation.
    const local = getManifest(task.appId)
    if (local && local.type && local.type !== 'app') {
      enqueueReport(task.taskId, {
        status: 'SKIPPED',
        reasonCode: 'APP_NOT_INSTALLED',
        summary: `Installed resource ${task.appId} is not a runnable app`
      })
      return
    }
    if (!task.confirmed) {
      const plan = planInstall(task, local)
      if (plan.action === 'skip') {
        enqueueReport(task.taskId, { status: 'SKIPPED', reasonCode: plan.reasonCode, summary: plan.summary })
        return
      }
      task = {
        ...task,
        installAction: plan.action === 'run' ? undefined : plan.action,
        localVersion: local?.version
      }
    }

    // 3. Workspace
    const workspace = getActiveWorkspace()
    if (!workspace || !workspace.path) {
      enqueueReport(task.taskId, {
        status: 'SKIPPED',
        reasonCode: 'NO_WORKSPACE',
        summary: 'No active workspace selected'
      })
      return
    }

    // 4. Confirmation
    if (!task.confirmed && needsConfirm(task, local, mode)) {
      try {
        await postJson(`/client/tasks/${encodeURIComponent(task.taskId)}/status`, {
          machineId: getMachineId(),
          status: 'WAITING_CONFIRM'
        })
      } catch (err) {
        logger.warn(`[RemoteTask] Failed to set WAITING_CONFIRM for ${task.taskId}:`, err)
      }
      this.waiting.set(task.taskId, task)
      this.notifyWaitingChanged()
      return // don't block the queue
    }

    // 5. Install / upgrade (only reached after confirmation, see needsConfirm)
    if (task.installAction) {
      logger.info(`[RemoteTask] ${task.installAction} ${task.appId}@${task.appVersion}`)
      const inst = await installMarketApp(task.appId, task.appVersion, task.packageSha256)
      if (!inst.success) {
        enqueueReport(task.taskId, {
          status: 'SKIPPED',
          reasonCode: inst.reasonCode || 'INSTALL_FAILED',
          summary: inst.error || 'Failed to install the required version'
        })
        return
      }
    }
    const manifest = getManifest(task.appId)
    const appPath = getSubAppPath(task.appId)
    if (!manifest || !appPath) {
      enqueueReport(task.taskId, {
        status: 'SKIPPED',
        reasonCode: 'APP_NOT_INSTALLED',
        summary: `Application ${task.appId} could not be resolved`
      })
      return
    }
    if (manifest.version !== task.appVersion) {
      enqueueReport(task.taskId, {
        status: 'SKIPPED',
        reasonCode: 'VERSION_MISMATCH',
        summary: `Installed version (${manifest.version}) differs from required (${task.appVersion})`
      })
      return
    }

    // 6. One run per app at a time
    const gen = this.generation
    while (isAppRunning(task.appId)) {
      logger.info(`[RemoteTask] App ${task.appId} is running, waiting ${SAME_APP_WAIT_MS / 1000}s...`)
      await sleep(SAME_APP_WAIT_MS)
      if (!this.isCurrent(gen)) return
    }

    // 7. Server gate: → RUNNING (fails if revoked / expired / already run)
    try {
      const resp = await postJson(`/client/tasks/${encodeURIComponent(task.taskId)}/status`, {
        machineId: getMachineId(),
        status: 'RUNNING'
      })
      if (resp.status === 409 || resp.status === 410) {
        logger.warn(`[RemoteTask] Task ${task.taskId} rejected by server gate (HTTP ${resp.status})`)
        return
      }
      if (!resp.ok) throw new Error(`gate HTTP ${resp.status}`)
    } catch (err) {
      logger.error(`[RemoteTask] Failed to enter RUNNING for ${task.taskId}:`, err)
      enqueueReport(task.taskId, {
        status: 'FAILED',
        reasonCode: 'CLIENT_ERROR',
        summary: `Failed to acquire running gate: ${String(err)}`
      })
      return
    }

    await this.execute(task, manifest, appPath, workspace)
  }

  private async execute(
    task: RemoteTask,
    manifest: NonNullable<ReturnType<typeof getManifest>>,
    appPath: string,
    workspace: NonNullable<ReturnType<typeof getActiveWorkspace>>
  ): Promise<void> {
    const execTaskId = randomUUID()
    const startedAt = Date.now()
    const appName = manifest.name || task.appName
    const dispatcher = task.dispatchedByName || mainT('remoteTask.unknownDispatcher')
    setInFlight(task.taskId, startedAt)

    const taskLog = createTaskLogger(
      task.taskId,
      task.appId,
      task.appVersion,
      task.dispatchedByName || '',
      task.presetParams,
      startedAt
    )
    const emitOutput = (message: string, level: string): void => {
      sendToAllWindows('subapp:output', {
        taskId: execTaskId,
        type: 'output',
        message,
        level,
        timestamp: Date.now()
      })
    }
    const finishUi = (status: 'completed' | 'failed' | 'cancelled', summary: string): void => {
      sendToAllWindows('subapp:task-status', {
        taskId: execTaskId,
        status,
        success: status === 'completed',
        cancelled: status === 'cancelled',
        summary,
        timestamp: Date.now()
      })
    }

    // Visible in the output panel with a "Remote" badge, like scheduled runs.
    sendToAllWindows('subapp:task-started', {
      taskId: execTaskId,
      appId: task.appId,
      appName,
      remote: true
    })
    emitOutput(mainT('remoteTask.announce', appName, dispatcher), 'info')
    if (!task.confirmed) {
      // Silent mode: make sure the user still learns that something runs.
      notify(
        mainT('remoteTask.notifyRunningTitle', appName),
        mainT('remoteTask.notifyRunningBody', task.reason || '')
      )
    }

    // Shared pipeline: strips `__` keys, builtin kill-switch, project config, Python + requirements.
    const prep = await prepareSubAppRun(
      { appId: task.appId, appName, appPath },
      task.presetParams,
      (message, level) => {
        taskLog.logOutput(message, level)
        emitOutput(message, level)
      }
    )
    if (!prep.ok) {
      clearInFlight(task.taskId)
      const summary = prep.i18nKey ? mainT(prep.i18nKey, ...(prep.i18nArgs ?? [])) : prep.message
      taskLog.logSystem(summary)
      const logExcerpt = taskLog.close(null)
      enqueueReport(task.taskId, {
        status: 'SKIPPED',
        reasonCode: prep.status === 'disabled' ? 'APP_DISABLED' : 'PYTHON_UNAVAILABLE',
        summary,
        logExcerpt
      })
      finishUi('failed', summary)
      return
    }

    const heartbeatTimer = setInterval(() => {
      postJson(`/client/tasks/${encodeURIComponent(task.taskId)}/heartbeat`, {
        machineId: getMachineId()
      }).catch((err) => logger.warn(`[RemoteTask] Heartbeat failed for ${task.taskId}:`, err))
    }, HEARTBEAT_MS)

    let exitCode = null as number | null
    let resultSuccess = false
    let resultSummary = ''
    let isCancelled = false

    try {
      await new Promise<void>((resolve) => {
        let settled = false
        const done = (): void => {
          if (settled) return
          settled = true
          resolve()
        }
        executeSubAppWithCallbacks(
          execTaskId,
          task.appId,
          appName,
          manifest.version,
          appPath,
          manifest.entry,
          prep.params,
          workspace as unknown as Parameters<typeof executeSubAppWithCallbacks>[7],
          prep.python.path,
          getPythonSdkPath(),
          {
            onOutput: (message, level) => {
              taskLog.logOutput(message, level)
              emitOutput(message, level)
            },
            onProgress: (percent, message) => {
              taskLog.logProgress(percent, message)
              sendToAllWindows('subapp:progress', {
                taskId: execTaskId,
                type: 'progress',
                percent,
                message,
                timestamp: Date.now()
              })
            },
            onComplete: (success, summary, cancelled) => {
              resultSuccess = success
              resultSummary = summary
              isCancelled = !!cancelled
              taskLog.logResult(success, summary)
              // Spawn errors complete without a close event; don't hang the queue.
              setTimeout(done, 30_000)
            },
            onExit: (code) => {
              exitCode = code
              // let a trailing result line / fallback onComplete land first
              setTimeout(done, 0)
            }
          }
        )
      })
    } finally {
      clearInterval(heartbeatTimer)
      clearInFlight(task.taskId)
    }

    const finalStatus: 'SUCCESS' | 'FAILED' | 'CANCELLED' = isCancelled
      ? 'CANCELLED'
      : resultSuccess && (exitCode === 0 || exitCode === null)
        ? 'SUCCESS'
        : 'FAILED'
    const summary =
      resultSummary ||
      mainT(finalStatus === 'SUCCESS' ? 'subapp.executionSucceeded' : 'subapp.executionFailed')

    enqueueReport(task.taskId, {
      status: finalStatus,
      exitCode,
      durationMs: Date.now() - startedAt,
      summary,
      logExcerpt: taskLog.close(exitCode)
    })

    finishUi(
      finalStatus === 'SUCCESS' ? 'completed' : finalStatus === 'CANCELLED' ? 'cancelled' : 'failed',
      summary
    )
    notify(
      mainT(finalStatus === 'SUCCESS' ? 'remoteTask.notifyDoneTitle' : 'remoteTask.notifyFailedTitle', appName),
      summary
    )
  }
}

export const remoteTaskService = new RemoteTaskService()

import * as pty from 'node-pty'
import { BrowserWindow } from 'electron'
import * as logger from '../utils/logger'
import type { AIToolType } from '../store/ai-workbench.store'

// ── Active PTY sessions ──
const ptySessions = new Map<string, pty.IPty>()

// Sessions that were programmatically killed — suppress their onExit notification
const suppressedSessions = new Set<string>()

// ── Per-session output batching ──
const pendingBuffers = new Map<string, string>()
const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>()

// ── Output ring-buffer for IM bridge (ANSI-stripped) ──
const outputBuffers = new Map<string, string>()
const RING_BUFFER_MAX = 4000

// ── Raw ANSI output ring-buffer for terminal replay ──
const rawOutputBuffers = new Map<string, string>()
const RAW_RING_BUFFER_MAX = 80000

// ── Per-session line accumulator for handling \r overwrites ──
const pendingLines = new Map<string, string>()

// ── Per-session exit callbacks ──
const exitCallbacks = new Map<string, (sessionId: string, exitCode: number) => void>()

// ── Debounced output-change callbacks (for IM bridge) ──
const outputChangeCallbacks = new Map<string, (sessionId: string) => void>()
const outputChangeTimers = new Map<string, ReturnType<typeof setTimeout>>()
const OUTPUT_STABILIZE_MS = 2000

/**
 * Strip ANSI escape sequences and control characters from PTY output.
 * Keeps \r and \n for semantic processing in appendPtyOutput.
 */
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')        // CSI sequences (cursor, color, erase, etc.)
    .replace(/\x1b\][^\x07]*\x07/g, '')            // OSC sequences
    .replace(/\x1b\[[\?]?[0-9;]*[hlr]/g, '')       // mode set/reset
    .replace(/\x1b[()][0-9A-Za-z]/g, '')            // character set designation
    .replace(/\x1b[A-Za-z]/g, '')                   // single-char escape commands
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')  // control chars except \t(09) \n(0a) \r(0d)
}

/**
 * Append PTY output to the ring buffer, handling \r as line-overwrite.
 *
 * TUI apps (Codex, Gemini, etc.) use \r to redraw spinner/progress lines.
 * Instead of blindly concatenating, we track the current incomplete line
 * and reset it on \r so only the final content is kept.
 */
function appendPtyOutput(sessionId: string, text: string): void {
  const stripped = stripAnsi(text)
  if (!stripped) return

  let pending = pendingLines.get(sessionId) ?? ''
  let completedLines = ''

  for (let i = 0; i < stripped.length; i++) {
    const ch = stripped[i]
    if (ch === '\n') {
      completedLines += pending + '\n'
      pending = ''
    } else if (ch === '\r') {
      // \r\n → treat as newline
      if (i + 1 < stripped.length && stripped[i + 1] === '\n') {
        completedLines += pending + '\n'
        pending = ''
        i++ // skip \n
      } else {
        // Standalone \r: overwrite current line from beginning (spinner/progress)
        pending = ''
      }
    } else {
      pending += ch
    }
  }

  pendingLines.set(sessionId, pending)

  if (!completedLines) return

  const existing = outputBuffers.get(sessionId) ?? ''
  const combined = existing + completedLines
  outputBuffers.set(
    sessionId,
    combined.length > RING_BUFFER_MAX ? combined.slice(-RING_BUFFER_MAX) : combined
  )

  // Debounced output-change notification: fires when output stabilizes (no new data for N ms)
  const cb = outputChangeCallbacks.get(sessionId)
  if (cb) {
    const existingTimer = outputChangeTimers.get(sessionId)
    if (existingTimer) clearTimeout(existingTimer)
    outputChangeTimers.set(
      sessionId,
      setTimeout(() => {
        outputChangeTimers.delete(sessionId)
        cb(sessionId)
      }, OUTPUT_STABILIZE_MS)
    )
  }
}

/**
 * Resolve the shell command + args for a given tool type.
 */
export function getToolCommand(toolType: AIToolType): { command: string; args: string[] } {
  switch (toolType) {
    case 'claude':
      return { command: 'claude', args: [] }
    case 'codex':
      return { command: 'codex', args: [] }
    case 'gemini':
      return { command: 'gemini', args: [] }
    case 'terminal':
      return {
        command: process.platform === 'win32' ? 'cmd.exe' : (process.env.SHELL || '/bin/bash'),
        args: []
      }
  }
}

/**
 * Get resume arguments for tools that support session resumption.
 */
export function getResumeArgs(toolType: AIToolType, toolSessionId: string): string[] {
  switch (toolType) {
    case 'claude':
      return ['--resume', toolSessionId]
    case 'codex':
      return ['resume', toolSessionId]
    case 'gemini':
      return ['--resume', toolSessionId]
    default:
      return []
  }
}

/**
 * Flush the batched output buffer for a session to all renderer windows.
 */
function flushBuffer(sessionId: string): void {
  const data = pendingBuffers.get(sessionId)
  pendingTimers.delete(sessionId)
  if (!data) return
  pendingBuffers.delete(sessionId)

  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send('pty:data', { sessionId, data })
  })
}

/**
 * Spawn a new PTY session.
 */
export function createPtySession(
  sessionId: string,
  command: string,
  args: string[],
  cwd: string,
  env?: Record<string, string>,
  onExit?: (sessionId: string, exitCode: number) => void
): void {
  // Kill any existing session with this ID
  killPtySession(sessionId)

  // Ensure UTF-8 locale and true-colour support regardless of user shell config
  const baseEnv: Record<string, string> = {
    LANG: 'en_US.UTF-8',
    LC_ALL: 'en_US.UTF-8',
    LC_CTYPE: 'en_US.UTF-8',
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor'
  }

  let ptyProcess: pty.IPty
  try {
    ptyProcess = pty.spawn(command, args, {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd,
      env: { ...(env ?? process.env), ...baseEnv } as Record<string, string>
    })
  } catch (err) {
    logger.error(`[pty] Failed to create session: ${sessionId}`, err)
    throw err
  }

  logger.info(`[pty] Session created: ${sessionId} cmd=${command}`)
  ptySessions.set(sessionId, ptyProcess)
  if (onExit) exitCallbacks.set(sessionId, onExit)

  // Batched data forwarding: accumulate output and flush every 16ms
  ptyProcess.onData((data: string) => {
    // Feed ANSI-stripped output into the ring buffer for IM bridge
    appendPtyOutput(sessionId, data)

    // Accumulate raw ANSI output for terminal replay on remount
    const raw = rawOutputBuffers.get(sessionId) ?? ''
    const combined = raw + data
    rawOutputBuffers.set(sessionId, combined.length > RAW_RING_BUFFER_MAX
      ? combined.slice(combined.length - RAW_RING_BUFFER_MAX)
      : combined)

    const existing = pendingBuffers.get(sessionId) ?? ''
    pendingBuffers.set(sessionId, existing + data)

    if (!pendingTimers.has(sessionId)) {
      const timer = setTimeout(() => flushBuffer(sessionId), 16)
      pendingTimers.set(sessionId, timer)
    }
  })

  ptyProcess.onExit(({ exitCode }) => {
    // Flush any remaining buffered data
    const pendingTimer = pendingTimers.get(sessionId)
    if (pendingTimer) {
      clearTimeout(pendingTimer)
      flushBuffer(sessionId)
    }

    // Skip renderer notification if this was a programmatic kill (e.g. React StrictMode double-invoke)
    if (!suppressedSessions.has(sessionId)) {
      BrowserWindow.getAllWindows().forEach((win) => {
        win.webContents.send('pty:exit', { sessionId, exitCode })
      })
      // Fire exit callback for session status management (IM bridge, etc.)
      const cb = exitCallbacks.get(sessionId)
      if (cb) cb(sessionId, exitCode)
    }
    suppressedSessions.delete(sessionId)
    exitCallbacks.delete(sessionId)

    // Only clean up if this specific process is still the active one.
    // PTY1's delayed onExit must not evict PTY2 when StrictMode re-mounts.
    if (ptySessions.get(sessionId) === ptyProcess) {
      ptySessions.delete(sessionId)
      pendingBuffers.delete(sessionId)
      pendingTimers.delete(sessionId)
      outputBuffers.delete(sessionId)
      rawOutputBuffers.delete(sessionId)
      pendingLines.delete(sessionId)
      unregisterPtyOutputCallback(sessionId)
    }
  })
}

/**
 * Write data to a PTY session's stdin.
 */
export function writeToPty(sessionId: string, data: string): void {
  const ptyProcess = ptySessions.get(sessionId)
  if (ptyProcess) {
    ptyProcess.write(data)
  }
}

/**
 * Resize a PTY session.
 */
export function resizePty(sessionId: string, cols: number, rows: number): void {
  const ptyProcess = ptySessions.get(sessionId)
  if (ptyProcess) {
    ptyProcess.resize(cols, rows)
  }
}

/**
 * Kill and remove a PTY session.
 */
export function killPtySession(sessionId: string): void {
  const ptyProcess = ptySessions.get(sessionId)
  if (!ptyProcess) return

  const pendingTimer = pendingTimers.get(sessionId)
  if (pendingTimer) {
    clearTimeout(pendingTimer)
  }

  // Mark as suppressed BEFORE killing so onExit won't notify the renderer
  suppressedSessions.add(sessionId)

  try {
    ptyProcess.kill()
  } catch {
    /* already dead */
  }

  logger.info(`[pty] Session killed: ${sessionId}`)
  ptySessions.delete(sessionId)
  pendingBuffers.delete(sessionId)
  pendingTimers.delete(sessionId)
  outputBuffers.delete(sessionId)
  pendingLines.delete(sessionId)
  exitCallbacks.delete(sessionId)
  unregisterPtyOutputCallback(sessionId)
}

/**
 * Check whether a PTY session exists.
 */
export function hasPtySession(sessionId: string): boolean {
  return ptySessions.has(sessionId)
}

/**
 * Get the ANSI-stripped ring buffer output for a PTY session (for IM cards).
 * Includes the current incomplete line so in-progress content is visible.
 */
export function getPtySessionOutput(sessionId: string): string {
  const buffer = outputBuffers.get(sessionId) ?? ''
  const pending = pendingLines.get(sessionId) ?? ''
  return pending ? buffer + pending : buffer
}

/**
 * Get raw ANSI output for a PTY session (for terminal replay on remount).
 */
export function getRawPtyOutput(sessionId: string): string {
  return rawOutputBuffers.get(sessionId) ?? ''
}

/**
 * Register a debounced output-change callback for a PTY session.
 * The callback fires when output stabilizes (no new data for 2 seconds).
 */
export function registerPtyOutputCallback(
  sessionId: string,
  cb: (sessionId: string) => void
): void {
  outputChangeCallbacks.set(sessionId, cb)
}

/**
 * Unregister the output-change callback for a PTY session.
 */
export function unregisterPtyOutputCallback(sessionId: string): void {
  outputChangeCallbacks.delete(sessionId)
  const timer = outputChangeTimers.get(sessionId)
  if (timer) {
    clearTimeout(timer)
    outputChangeTimers.delete(sessionId)
  }
}

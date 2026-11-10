/**
 * Local log files for remote (server-dispatched) task runs.
 *
 * Every remote run writes a full, redacted log to
 * `{userData}/task-logs/remote/` (30-day / 200-file retention) so the user can
 * audit what a server made this machine do (Settings → Remote Tasks → View
 * logs). A head+tail excerpt is reported back to the server.
 */
import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import * as logger from '../utils/logger'

const RETENTION_DAYS = 30
const MAX_LOG_FILES = 200
const MAX_EXCERPT_CHARS = 32_000
const EXCERPT_HEAD_LINES = 50
const EXCERPT_TAIL_LINES = 50

export function getRemoteTaskLogDir(): string {
  const dir = path.join(app.getPath('userData'), 'task-logs', 'remote')
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return dir
}

export function cleanOldRemoteTaskLogs(): void {
  try {
    const dir = getRemoteTaskLogDir()
    const files = fs.readdirSync(dir)
    const now = Date.now()
    const maxAgeMs = RETENTION_DAYS * 24 * 60 * 60 * 1000

    const fileStats: Array<{ path: string; mtime: number }> = []

    for (const file of files) {
      if (!file.endsWith('.log')) continue
      const fullPath = path.join(dir, file)
      try {
        const stat = fs.statSync(fullPath)
        if (now - stat.mtimeMs > maxAgeMs) {
          fs.unlinkSync(fullPath)
        } else {
          fileStats.push({ path: fullPath, mtime: stat.mtimeMs })
        }
      } catch {
        // ignore single file error
      }
    }

    if (fileStats.length > MAX_LOG_FILES) {
      fileStats.sort((a, b) => a.mtime - b.mtime) // oldest first
      const toDelete = fileStats.length - MAX_LOG_FILES
      for (let i = 0; i < toDelete; i++) {
        try {
          fs.unlinkSync(fileStats[i].path)
        } catch {
          // ignore
        }
      }
    }
  } catch (err) {
    logger.warn('[RemoteTaskLog] Failed to clean old logs:', err)
  }
}

/** Redacts common credential shapes before anything is written or reported. */
export function sanitizeLogString(content: string): string {
  return content
    .replace(
      /(["']?\b(?:password|passwd|pwd|token|secret|api[_-]?key|access[_-]?key|key)\b["']?\s*[=:]\s*["']?)([^\s&"',}]+)/gi,
      '$1***'
    )
    .replace(/(Authorization:\s*Bearer\s+)[^\s]+/gi, '$1***')
    .replace(/(Authorization:\s*)(?!Bearer\s)[^\s]+/gi, '$1***')
    .replace(/(--(?:password|token)[\s=]+)[^\s]+/gi, '$1***')
    .replace(/(https?:\/\/)([^:@\s/]+):([^@\s/]+)@/gi, '$1$2:***@')
}

function timestamp(): string {
  const d = new Date()
  const pad = (n: number, w = 2): string => String(n).padStart(w, '0')
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
  )
}

export interface RemoteTaskLoggerHandle {
  logSystem: (message: string) => void
  logOutput: (message: string, level?: string) => void
  logProgress: (percent: number, message: string) => void
  logResult: (success: boolean, summary: string) => void
  close: (exitCode: number | null) => string
}

/** Head + tail excerpt of the collected lines, capped at MAX_EXCERPT_CHARS. */
export function buildExcerpt(lines: string[]): string {
  let excerpt: string
  if (lines.length <= EXCERPT_HEAD_LINES + EXCERPT_TAIL_LINES) {
    excerpt = lines.join('\n')
  } else {
    const head = lines.slice(0, EXCERPT_HEAD_LINES)
    const tail = lines.slice(lines.length - EXCERPT_TAIL_LINES)
    const skipped = lines.length - EXCERPT_HEAD_LINES - EXCERPT_TAIL_LINES
    excerpt = `${head.join('\n')}\n... [${skipped} lines omitted] ...\n${tail.join('\n')}`
  }
  return excerpt.length > MAX_EXCERPT_CHARS ? excerpt.slice(0, MAX_EXCERPT_CHARS) : excerpt
}

export function createTaskLogger(
  taskId: string,
  appId: string,
  version: string,
  dispatchedByName: string,
  params: Record<string, unknown>,
  startedAt: number
): RemoteTaskLoggerHandle {
  const dir = getRemoteTaskLogDir()
  const fileName = `task-${taskId.replace(/[^a-zA-Z0-9._-]/g, '_')}-${startedAt}.log`
  const filePath = path.join(dir, fileName)

  const stream = fs.createWriteStream(filePath, { flags: 'a', encoding: 'utf-8' })
  stream.on('error', (err) => logger.warn('[RemoteTaskLog] write failed:', err))

  // Keep only what the excerpt needs (head + rolling tail) to bound memory.
  const head: string[] = []
  const tail: string[] = []
  let total = 0

  const append = (line: string): void => {
    total++
    if (head.length < EXCERPT_HEAD_LINES) head.push(line)
    else {
      tail.push(line)
      if (tail.length > EXCERPT_TAIL_LINES) tail.shift()
    }
    try {
      stream.write(line + '\n')
    } catch {
      // ignore
    }
  }

  const prefix = (tag: string): string => `[${timestamp()}] [${tag}]`

  append(
    `${prefix('INFO')} [System] Remote task ${taskId}: ${appId}@${version} (by ${dispatchedByName || 'unknown'}) params=${sanitizeLogString(JSON.stringify(params))}`
  )

  return {
    logSystem(message: string): void {
      append(`${prefix('System')} ${sanitizeLogString(message)}`)
    },
    logOutput(message: string, level = 'INFO'): void {
      append(`${prefix(level.toUpperCase())} ${sanitizeLogString(message)}`)
    },
    logProgress(percent: number, message: string): void {
      append(`${prefix(`PROGRESS ${percent}%`)} ${sanitizeLogString(message)}`)
    },
    logResult(success: boolean, summary: string): void {
      append(`${prefix('RESULT')} success=${success} ${sanitizeLogString(summary)}`)
    },
    close(exitCode: number | null): string {
      append(`${prefix('System')} Process exited with code ${exitCode ?? 'unknown'}`)
      try {
        stream.end()
      } catch {
        // ignore
      }
      const skipped = total - head.length - tail.length
      const excerpt =
        skipped <= 0
          ? [...head, ...tail].join('\n')
          : `${head.join('\n')}\n... [${skipped} lines omitted] ...\n${tail.join('\n')}`
      return excerpt.length > MAX_EXCERPT_CHARS ? excerpt.slice(0, MAX_EXCERPT_CHARS) : excerpt
    }
  }
}

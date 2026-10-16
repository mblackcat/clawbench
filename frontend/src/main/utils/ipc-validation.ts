/**
 * Runtime input sanity checks for IPC handlers.
 *
 * The renderer is our own code, so these are *shape* checks (type, length,
 * null bytes, known enums) that turn a malformed call into a clean error
 * instead of a crash deep inside a service. They are deliberately NOT a
 * security sandbox: paths may legitimately be absolute, live on any drive,
 * contain spaces / CJK / `..` inside a name, and commands may legitimately use
 * pipes, `$()` or backticks. Callers that need confinement (e.g. "must be
 * inside the user-apps dir") must enforce it with a resolved-path check.
 */

import type { AIToolType } from '../store/ai-coding.store'

/** Every AI coding tool id known to `ai-coding.store.ts` (incl. legacy `qwen`). */
const TOOL_TYPES = {
  claude: true,
  codex: true,
  antigravity: true,
  gemini: true,
  grok: true,
  opencode: true,
  trae: true,
  qoder: true,
  kimi: true,
  zcode: true,
  mimo: true,
  omp: true,
  terminal: true,
  qwen: true
} satisfies Record<AIToolType, true>

const VALID_TOOL_TYPES = new Set<string>(Object.keys(TOOL_TYPES))

/**
 * Register additional tool ids at runtime (e.g. a feature that adds a new CLI
 * before `AIToolType` is widened). Prefer extending `AIToolType` instead.
 */
export function registerValidToolType(toolType: string): void {
  if (toolType) VALID_TOOL_TYPES.add(toolType)
}

/**
 * Permission modes accepted by `ai-coding:set-permission-mode`.
 *
 * The renderer (`toRuntimePermissionMode` in useAICodingStore) sends the
 * *runtime* vocabulary:
 *  - Claude SDK: default | acceptEdits | bypassPermissions | plan | dontAsk
 *  - Codex:      ask | approve-for-me | full-access
 * The abstract UI modes (`CodingMode`) and legacy persisted values are also
 * accepted because both services normalize them.
 */
export const VALID_PERMISSION_MODES: ReadonlySet<string> = new Set([
  // Claude SDK PermissionMode
  'default',
  'acceptEdits',
  'bypassPermissions',
  'plan',
  'dontAsk',
  // Codex
  'ask',
  'approve-for-me',
  'full-access',
  // Renderer CodingMode (Claude side)
  'manual',
  'edit-automatically',
  'auto',
  // Legacy persisted values
  'ask-first',
  'auto-edit'
])

/** Reasoning-effort levels (mirrors renderer `CodingEffort`). */
export const VALID_EFFORT_LEVELS: ReadonlySet<string> = new Set([
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultracode'
])

const MAX_PATH_LENGTH = 4096
const MAX_COMMAND_LENGTH = 10_000
const MAX_ID_LENGTH = 200

function hasControlChars(value: string, allowNewlines: boolean): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code === 0) return true
    if (code < 0x20) {
      if (allowNewlines && (code === 0x09 || code === 0x0a || code === 0x0d)) continue
      return true
    }
  }
  return false
}

export function validateToolType(toolType: unknown): toolType is AIToolType {
  return typeof toolType === 'string' && VALID_TOOL_TYPES.has(toolType)
}

export function validatePermissionMode(mode: unknown): mode is string {
  return typeof mode === 'string' && VALID_PERMISSION_MODES.has(mode)
}

export function validateEffort(effort: unknown): effort is string {
  return typeof effort === 'string' && VALID_EFFORT_LEVELS.has(effort)
}

/**
 * Validate an id coming from the renderer (workspace / session / group /
 * request ids, native tool session ids). Allows `[A-Za-z0-9_.:-]`, rejects
 * the bare `.` / `..` path segments and anything with a separator.
 */
export function validateId(id: unknown): id is string {
  if (typeof id !== 'string') return false
  if (id.length === 0 || id.length > MAX_ID_LENGTH) return false
  if (id === '.' || id === '..') return false
  return /^[A-Za-z0-9_.:-]+$/.test(id)
}

/**
 * True when one of the path's *segments* is exactly `..`. Names that merely
 * contain two dots (`my..notes`, `v1..2`, `..hidden`) are fine.
 */
export function hasParentSegment(p: string): boolean {
  return p.split(/[\\/]+/).some((seg) => seg === '..')
}

function sanitizePath(p: unknown, opts: { allowParentSegments: boolean }): string | null {
  if (typeof p !== 'string') return null
  if (!p.trim()) return null
  if (p.length > MAX_PATH_LENGTH) return null
  if (hasControlChars(p, false)) return null
  if (!opts.allowParentSegments && hasParentSegment(p)) return null
  return p
}

/**
 * Basic sanity check for a file path from the renderer. Accepts POSIX and
 * Windows absolute paths (`C:\...`, `\\server\share`), relative paths, and
 * names containing `..` as a substring. Rejects non-strings, empty,
 * overlong, control characters / null bytes, and — unless
 * `allowParentSegments` — a `..` path segment.
 */
export function validateFilePath(
  filePath: unknown,
  opts: { allowParentSegments?: boolean } = {}
): string | null {
  return sanitizePath(filePath, { allowParentSegments: opts.allowParentSegments ?? false })
}

/** Same rules as {@link validateFilePath}, for directories. */
export function validateDirPath(
  dirPath: unknown,
  opts: { allowParentSegments?: boolean } = {}
): string | null {
  return sanitizePath(dirPath, { allowParentSegments: opts.allowParentSegments ?? false })
}

/**
 * Sanity check for a user-provided command line (type, length, no null
 * bytes). Shell metacharacters are intentionally allowed — the user typed the
 * command; filtering `|`, `$()` or backticks only breaks legitimate use.
 */
export function validateCommand(command: unknown): string | null {
  if (typeof command !== 'string') return null
  if (command.length > MAX_COMMAND_LENGTH) return null
  if (command.includes('\0')) return null
  return command
}

/** PTY dimensions: positive integers within a generous bound. */
export function validatePtyDimensions(
  cols: unknown,
  rows: unknown
): { cols: number; rows: number } | null {
  const c = typeof cols === 'number' ? cols : typeof cols === 'string' ? Number(cols) : NaN
  const r = typeof rows === 'number' ? rows : typeof rows === 'string' ? Number(rows) : NaN
  if (!Number.isInteger(c) || !Number.isInteger(r)) return null
  if (c < 1 || c > 2000 || r < 1 || r > 1000) return null
  return { cols: c, rows: r }
}

const VALID_IMAGE_MEDIA_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp'
])

/** Max base64 payload length (~15 MB of base64 ≈ 11 MB image). */
const MAX_IMAGE_BASE64_LENGTH = 15_000_000

/** Validate an inline image attachment `{ data: base64, mediaType }`. */
export function validateImageData(
  image: unknown
): image is { data: string; mediaType: string } {
  if (!image || typeof image !== 'object') return false
  const { data, mediaType } = image as { data?: unknown; mediaType?: unknown }
  if (typeof data !== 'string' || typeof mediaType !== 'string') return false
  if (!VALID_IMAGE_MEDIA_TYPES.has(mediaType.toLowerCase())) return false
  if (data.length === 0 || data.length > MAX_IMAGE_BASE64_LENGTH) return false
  return true
}

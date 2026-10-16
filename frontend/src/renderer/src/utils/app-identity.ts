/**
 * App identity helpers — author ownership checks and stable app id generation.
 */

import { pinyin } from 'pinyin-pro'
import type { User } from '../types/auth'
import type { SubAppManifest } from '../types/subapp'

/** Leading segment of generated app ids (`cb.<username>.<slug>`). */
export const APP_ID_PREFIX = 'cb'

/** CJK unified ideographs (common Chinese ranges). */
const CJK_RE = /[\u3400-\u9fff\uf900-\ufaff]/

export function hasCjkChars(raw: string | undefined | null): boolean {
  return !!raw && CJK_RE.test(raw)
}

/**
 * Keep a-z0-9 only for reverse-DNS style segments.
 * Returns empty string when nothing usable remains (caller decides fallback).
 */
export function asciiAlnum(raw: string | undefined | null): string {
  return (raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 32)
}

/** Sanitize a username for use inside reverse-DNS style app ids. */
export function sanitizeAppUsername(raw: string | undefined | null): string {
  return asciiAlnum(raw) || 'user'
}

/** Chinese (or mixed) text → pure ascii via pinyin, no tones. */
export function chineseToPinyinAlnum(raw: string): string {
  const parts = pinyin(raw.trim(), {
    toneType: 'none',
    type: 'array',
    nonZh: 'consecutive' // keep latin runs as-is
  }) as string[]
  return asciiAlnum(parts.join(''))
}

/** Sanitize display name into a short slug segment. */
export function sanitizeAppSlug(name: string | undefined | null): string {
  const raw = (name || '').trim()
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  if (slug) return slug
  // CJK / non-latin names produce an empty ascii slug — use a short stable hash
  // so two different Chinese titles don't collide on "app".
  if (raw) {
    let h = 0
    for (let i = 0; i < raw.length; i++) {
      h = (Math.imul(h, 31) + raw.charCodeAt(i)) >>> 0
    }
    return `app-${h.toString(36).slice(0, 6)}`
  }
  return 'app'
}

/**
 * 确保应用 ID 唯一：若 baseId 在 existingIds 列表中已存在，
 * 自动追加数字后缀（-2, -3, ...）避免重名冲突。
 */
export function resolveUniqueAppId(
  baseId: string,
  existingIds?: Iterable<string | undefined | null> | null
): string {
  if (!existingIds) {
    return baseId
  }

  const existingSet = new Set<string>()
  for (const id of existingIds) {
    if (typeof id === 'string' && id.trim()) {
      existingSet.add(id.trim())
    }
  }

  if (!existingSet.has(baseId)) {
    return baseId
  }

  let index = 2
  while (existingSet.has(`${baseId}-${index}`)) {
    index++
  }
  return `${baseId}-${index}`
}

/**
 * Generate a stable app id: `cb.<username>.<slug>`
 * `username` may be a pre-resolved ascii handle or a full User (preferred).
 * If `existingIds` is provided, automatically appends suffix numbers on collision.
 */
export function generateAppId(
  name: string,
  usernameOrUser?: string | User | null,
  existingIds?: Iterable<string | undefined | null> | null
): string {
  const handle =
    usernameOrUser && typeof usernameOrUser === 'object'
      ? resolveUsernameForAppId(usernameOrUser)
      : sanitizeAppUsername(usernameOrUser as string | null | undefined)
  const baseId = `${APP_ID_PREFIX}.${handle}.${sanitizeAppSlug(name)}`
  return resolveUniqueAppId(baseId, existingIds)
}

/**
 * Resolve the app-id username segment from auth user.
 *
 * Priority:
 *  1. username / name that is non-Chinese (ascii-friendly)
 *  2. email local-part (before @)
 *  3. Chinese username / name → pinyin letters
 *  4. fallback "user"
 */
export function resolveUsernameForAppId(user: User | null | undefined): string {
  if (!user) return 'user'

  const nameCandidates = [user.username, user.name]
    .map((s) => (typeof s === 'string' ? s.trim() : ''))
    .filter(Boolean)

  // 1) Prefer non-Chinese username/name with usable ascii
  for (const c of nameCandidates) {
    if (!hasCjkChars(c)) {
      const s = asciiAlnum(c)
      if (s) return s
    }
  }

  // 2) Email prefix
  if (user.email) {
    const at = user.email.indexOf('@')
    const local = at >= 0 ? user.email.slice(0, at) : user.email
    const s = asciiAlnum(local)
    if (s) return s
  }

  // 3) Chinese username/name → pinyin
  for (const c of nameCandidates) {
    if (hasCjkChars(c)) {
      const s = chineseToPinyinAlnum(c)
      if (s) return s
    }
  }

  // 4) Last resort — short alnum from id, else "user"
  const idPart = asciiAlnum(user.id)
  if (idPart && idPart !== 'local') return idPart.slice(0, 12)
  return 'user'
}

function collectUserIds(user: User | null | undefined): Set<string> {
  const ids = new Set<string>()
  if (!user) return ids
  if (user.id) ids.add(user.id)
  if (user.feishu_id) ids.add(user.feishu_id)
  if (user.feishuId) ids.add(user.feishuId)
  return ids
}

/**
 * Whether a local manifest is authored by the currently logged-in user.
 * Used by 「我的」 to hide market-installed / others' apps and builtins.
 */
export function isAuthoredByCurrentUser(
  author: SubAppManifest['author'] | undefined,
  user: User | null | undefined
): boolean {
  if (!user) return false

  if (!author) return false

  if (typeof author === 'string') {
    const a = author.trim()
    if (!a) return false
    return (
      a === user.name ||
      a === user.username ||
      a === user.id ||
      a === user.feishu_id ||
      a === user.feishuId
    )
  }

  const ids = collectUserIds(user)
  if (author.feishu_id && ids.has(author.feishu_id)) return true
  if (author.email && user.email && author.email === user.email) return true
  if (
    author.name &&
    (author.name === user.name ||
      author.name === user.username ||
      author.name === user.id)
  ) {
    return true
  }
  return false
}

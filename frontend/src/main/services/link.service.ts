import * as logger from '../utils/logger'

/**
 * Link resource type support: fetch a website's favicon and return it as a
 * base64 data URI so it can be persisted in the manifest and rendered offline
 * without remote img-src / CSP concerns.
 */

const FETCH_TIMEOUT_MS = 8000
const MAX_ICON_BYTES = 512 * 1024 // 512KB safety cap

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; ClawBench/1.0; +https://clawbench.local)',
        ...(init?.headers || {})
      }
    })
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Parses the page HTML for the best favicon candidate and resolves it to an
 * absolute URL. Falls back to `<origin>/favicon.ico`.
 */
function extractIconHref(html: string, baseUrl: string): string {
  const origin = new URL(baseUrl).origin
  const linkTagRegex = /<link\b[^>]*>/gi
  const relRegex = /\brel\s*=\s*["']([^"']+)["']/i
  const hrefRegex = /\bhref\s*=\s*["']([^"']+)["']/i

  const candidates: { href: string; priority: number }[] = []
  const matches = html.match(linkTagRegex) || []
  for (const tag of matches) {
    const rel = (tag.match(relRegex)?.[1] || '').toLowerCase()
    const href = tag.match(hrefRegex)?.[1]
    if (!href) continue
    if (rel.includes('apple-touch-icon')) candidates.push({ href, priority: 3 })
    else if (rel.includes('shortcut icon') || rel === 'icon' || rel.includes('icon'))
      candidates.push({ href, priority: rel.includes('icon') ? 2 : 1 })
  }

  candidates.sort((a, b) => b.priority - a.priority)
  const chosen = candidates[0]?.href
  if (chosen) {
    try {
      return new URL(chosen, baseUrl).toString()
    } catch {
      // fall through
    }
  }
  return `${origin}/favicon.ico`
}

/**
 * Fetches a favicon for the given page URL and returns it as a base64 data URI.
 * Returns null on any failure (caller falls back to a placeholder icon).
 */
export async function fetchFavicon(pageUrl: string): Promise<string | null> {
  try {
    const normalized = /^https?:\/\//i.test(pageUrl) ? pageUrl : `https://${pageUrl}`

    let iconUrl: string
    try {
      const pageRes = await fetchWithTimeout(normalized)
      const html = await pageRes.text()
      iconUrl = extractIconHref(html, pageRes.url || normalized)
    } catch {
      iconUrl = `${new URL(normalized).origin}/favicon.ico`
    }

    const iconRes = await fetchWithTimeout(iconUrl)
    if (!iconRes.ok) return null

    const contentType = iconRes.headers.get('content-type') || 'image/x-icon'
    if (!contentType.startsWith('image/')) return null

    const arrayBuf = await iconRes.arrayBuffer()
    if (arrayBuf.byteLength === 0 || arrayBuf.byteLength > MAX_ICON_BYTES) return null

    const base64 = Buffer.from(arrayBuf).toString('base64')
    return `data:${contentType};base64,${base64}`
  } catch (error) {
    logger.warn('fetchFavicon failed:', error)
    return null
  }
}

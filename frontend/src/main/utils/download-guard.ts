/**
 * Hardened download helpers for marketplace packages.
 *
 * Marketplace download URLs are built from the configured backend origin
 * (VITE_API_BASE_URL, baked at build time). Self-hosted backends commonly run
 * on a LAN address or localhost, so that origin is explicitly trusted; any
 * other private / loopback / link-local / bare-IP host is rejected to limit
 * SSRF exposure.
 */

export const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024
export const DOWNLOAD_TIMEOUT_MS = 30_000

const PRIVATE_HOST_PATTERNS: RegExp[] = [
  /^localhost$/,
  /^0\.0\.0\.0$/,
  /^127\.\d+\.\d+\.\d+$/,
  /^10\.\d+\.\d+\.\d+$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,
  /^192\.168\.\d+\.\d+$/,
  /^169\.254\.\d+\.\d+$/,
  /^\[?::1?\]?$/,
  /^\[?fc[0-9a-f]{0,2}:/i,
  /^\[?fd[0-9a-f]{0,2}:/i,
  /^\[?fe[89ab][0-9a-f]?:/i,
  /^\[?fec0:/i
]

function getTrustedHosts(configuredBase: string | undefined): Set<string> {
  const trusted = new Set<string>(['localhost'])
  if (configuredBase) {
    try {
      trusted.add(new URL(configuredBase).hostname.toLowerCase())
    } catch {
      /* ignore malformed config */
    }
  }
  return trusted
}

/**
 * Throws when `url` is not an acceptable marketplace download URL.
 * @param configuredBase backend base URL whose host is always trusted
 */
export function validateDownloadUrl(
  url: string,
  configuredBase: string | undefined = import.meta.env?.VITE_API_BASE_URL
): void {
  if (!url || typeof url !== 'string') {
    throw new Error('Invalid download URL')
  }

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('Invalid URL format')
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only HTTP/HTTPS URLs are allowed')
  }

  const hostname = parsed.hostname.toLowerCase()
  if (getTrustedHosts(configuredBase).has(hostname)) return

  if (PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(hostname))) {
    throw new Error('Private network addresses are not allowed')
  }

  // Require a hostname for non-trusted hosts (bare IPv4 / IPv6 literals).
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname) || hostname.startsWith('[')) {
    throw new Error('Direct IP addresses are not allowed')
  }
}

/**
 * Downloads a package archive with URL validation, a timeout and a size cap.
 */
export async function fetchPackageArchive(
  downloadUrl: string,
  token?: string,
  opts: { timeoutMs?: number; maxBytes?: number } = {}
): Promise<Buffer> {
  validateDownloadUrl(downloadUrl)
  const timeoutMs = opts.timeoutMs ?? DOWNLOAD_TIMEOUT_MS
  const maxBytes = opts.maxBytes ?? MAX_DOWNLOAD_BYTES

  const headers: Record<string, string> = {}
  if (token) headers['Authorization'] = `Bearer ${token}`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const resp = await fetch(downloadUrl, { headers, signal: controller.signal })
    if (!resp.ok) {
      throw new Error(`下载失败: HTTP ${resp.status}`)
    }

    const contentLength = resp.headers.get('content-length')
    if (contentLength && parseInt(contentLength, 10) > maxBytes) {
      throw new Error(`File size exceeds ${Math.round(maxBytes / 1024 / 1024)}MB limit`)
    }

    const buffer = await resp.arrayBuffer()
    if (buffer.byteLength > maxBytes) {
      throw new Error(`Downloaded file exceeds ${Math.round(maxBytes / 1024 / 1024)}MB limit`)
    }
    return Buffer.from(buffer)
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Download timeout (${Math.round(timeoutMs / 1000)}s)`)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Web search + fetch (Claude Code–inspired).
 *
 * Strategy (internalized — no user config for engines):
 * - web_search: DuckDuckGo by default; Brave only if an API key is already stored
 * - web_fetch: HTTP fetch → markdown-ish text; optional Lightpanda if binary is found
 * - Tool prompts encode when/how to search and mandatory Sources citations
 */
import { net } from 'electron'
import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { getAiToolsConfigRaw } from '../store/settings.store'
import * as logger from '../utils/logger'

export interface ToolResult {
  output?: string
  error?: string
  isError: boolean
}

const MAX_FETCH_CHARS = 12_000
const MAX_SEARCH_RESULTS = 8
const LIGHTPANDA_TIMEOUT = 20_000

// ── Tool definitions (Claude Code style) ──────────────────────────────

export function getCurrentMonthYear(): string {
  return new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' })
}

export const WEB_SEARCH_TOOL = {
  name: 'web_search',
  description: buildWebSearchDescription(),
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query. Include the current year for recent events or latest docs.',
      },
      maxResults: {
        type: 'number',
        description: `Max results (default 5, max ${MAX_SEARCH_RESULTS})`,
      },
    },
    required: ['query'],
  },
}

export const WEB_FETCH_TOOL = {
  name: 'web_browse',
  description: buildWebFetchDescription(),
  inputSchema: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'Fully-formed URL to fetch (http upgraded to https when possible)',
      },
      prompt: {
        type: 'string',
        description:
          'What to extract from the page (e.g. "summarize the release notes for v2"). Helps focus long pages.',
      },
    },
    required: ['url'],
  },
}

function buildWebSearchDescription(): string {
  const monthYear = getCurrentMonthYear()
  return [
    'Search the web for up-to-date information beyond your knowledge cutoff.',
    'Use for current events, latest versions/changelogs, uncertain facts, and user-linked research.',
    'Skip for greetings, pure math/logic, well-known APIs you already know, and follow-ups already answered in thread.',
    '',
    'CRITICAL — after answering from search results you MUST end with a Sources section listing relevant URLs as markdown links:',
    '  Sources:',
    '  - [Title](https://example.com/1)',
    '',
    `IMPORTANT — current month is ${monthYear}. Prefer this year in queries for recent docs/events.`,
    'Prefer 2–4 focused searches over exhaustive crawling; vary queries if results are thin.',
  ].join('\n')
}

function buildWebFetchDescription(): string {
  return [
    'Fetch a URL and return readable page text (HTML → plain/markdown).',
    'Use after web_search for promising links, or when the user provides a URL.',
    'Optional `prompt` describes what to extract so long pages stay focused.',
    'HTTP URLs may be upgraded to HTTPS. Do not re-fetch the same page path in one turn.',
    'This tool is read-only. Prefer dedicated APIs/CLIs (e.g. gh) for GitHub when available.',
  ].join(' ')
}

// ── Execution ─────────────────────────────────────────────────────────

export async function executeWebSearch(query: string, maxResults = 5): Promise<ToolResult> {
  const q = (query || '').trim()
  if (q.length < 2) {
    return { error: 'query must be at least 2 characters', isError: true }
  }
  const limit = Math.min(Math.max(1, maxResults || 5), MAX_SEARCH_RESULTS)

  // Silent backend selection: Brave only if key already present
  const config = getAiToolsConfigRaw()
  const braveKey = config?.webSearch?.braveApiKey?.trim()
  if (braveKey && config?.webSearch?.provider === 'brave') {
    const brave = await searchBrave(q, braveKey, limit)
    if (!brave.isError) return brave
    logger.warn('[web_search] Brave failed, falling back to DuckDuckGo:', brave.error)
  }

  return searchDuckDuckGo(q, limit)
}

export async function executeWebFetch(url: string, prompt?: string): Promise<ToolResult> {
  let target = (url || '').trim()
  if (!target) return { error: 'url is required', isError: true }

  // Upgrade http → https when safe
  if (target.startsWith('http://')) {
    target = 'https://' + target.slice('http://'.length)
  }
  if (!/^https?:\/\//i.test(target)) {
    target = 'https://' + target
  }

  try {
    // eslint-disable-next-line no-new
    new URL(target)
  } catch {
    return { error: `Invalid URL: ${url}`, isError: true }
  }

  // Silent Lightpanda if binary available
  const lp = resolveLightpandaPath()
  let result: ToolResult
  if (lp) {
    result = await fetchLightpanda(target, lp)
    if (result.isError) {
      logger.warn('[web_fetch] Lightpanda failed, HTTP fallback:', result.error)
      result = await fetchHttp(target)
    }
  } else {
    result = await fetchHttp(target)
  }

  if (result.isError || !result.output) return result

  let body = result.output
  if (prompt?.trim()) {
    body =
      `## Extraction focus\n${prompt.trim()}\n\n` +
      `## Page content\n${body}\n\n` +
      `(Answer the extraction focus using only the page content above.)`
  }
  if (body.length > MAX_FETCH_CHARS) {
    body =
      body.slice(0, MAX_FETCH_CHARS) +
      `\n\n…[truncated at ${MAX_FETCH_CHARS} chars; refine prompt or fetch a more specific URL]`
  }
  return { output: body, isError: false }
}

// ── Backends ──────────────────────────────────────────────────────────

async function searchDuckDuckGo(query: string, maxResults: number): Promise<ToolResult> {
  logger.info(`[web_search] DDG: "${query}"`)
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
    const response = await net.fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    })
    if (!response.ok) {
      return { error: `Search request failed: ${response.status}`, isError: true }
    }
    const html = await response.text()
    const results: Array<{ title: string; url: string; snippet: string }> = []
    const resultRegex =
      /<a[^>]+class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g
    let match: RegExpExecArray | null
    while ((match = resultRegex.exec(html)) !== null && results.length < maxResults) {
      const rawUrl = match[1]
      const title = match[2].replace(/<[^>]*>/g, '').trim()
      const snippet = match[3].replace(/<[^>]*>/g, '').trim()
      let finalUrl = rawUrl
      const uddgMatch = rawUrl.match(/[?&]uddg=([^&]+)/)
      if (uddgMatch) finalUrl = decodeURIComponent(uddgMatch[1])
      if (title && snippet) results.push({ title, url: finalUrl, snippet })
    }

    if (results.length === 0) {
      return { output: `No search results found for: "${query}"`, isError: false }
    }
    return { output: formatSearchResults(query, results), isError: false }
  } catch (err: any) {
    logger.error('[web_search] DDG failed:', err)
    return { error: `Web search failed: ${err.message}`, isError: true }
  }
}

async function searchBrave(query: string, apiKey: string, maxResults: number): Promise<ToolResult> {
  logger.info(`[web_search] Brave: "${query}"`)
  try {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${maxResults}`
    const response = await net.fetch(url, {
      headers: {
        'X-Subscription-Token': apiKey,
        Accept: 'application/json',
        'Cache-Control': 'no-cache',
      },
    })
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      return { error: `Brave search failed: ${response.status} ${body}`, isError: true }
    }
    const data = (await response.json()) as any
    const raw = (data.web?.results || []).slice(0, maxResults)
    if (!raw.length) {
      return { output: `No search results found for: "${query}"`, isError: false }
    }
    const results = raw.map((r: any) => ({
      title: r.title || '',
      url: r.url || '',
      snippet: [r.description, ...(r.extra_snippets || [])].filter(Boolean).join(' | '),
    }))
    return { output: formatSearchResults(query, results), isError: false }
  } catch (err: any) {
    return { error: `Brave search failed: ${err.message}`, isError: true }
  }
}

/** Claude Code–friendly formatting with markdown links for easy Sources sections. */
export function formatSearchResults(
  query: string,
  results: Array<{ title: string; url: string; snippet: string }>
): string {
  const lines = results.map((r, i) => {
    const title = r.title || r.url
    const link = r.url ? `[${title}](${r.url})` : title
    return `${i + 1}. ${link}\n   ${r.snippet || ''}`
  })
  return (
    `Search results for "${query}" (${results.length}):\n\n` +
    lines.join('\n\n') +
    `\n\n(When answering, cite sources as markdown links in a final Sources: section.)`
  )
}

function resolveLightpandaPath(): string | null {
  try {
    const config = getAiToolsConfigRaw()
    const configured = config?.webBrowse?.lightpandaPath?.trim()
    if (configured && existsSync(configured)) return configured
  } catch { /* ignore */ }

  const candidates = [
    join(homedir(), '.lightpanda', 'lightpanda'),
    join(homedir(), '.lightpanda', 'lightpanda.exe'),
    '/usr/local/bin/lightpanda',
    'C:\\Program Files\\lightpanda\\lightpanda.exe',
  ]
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  return null
}

async function fetchLightpanda(url: string, lightpandaPath: string): Promise<ToolResult> {
  return new Promise((resolve) => {
    const proc = spawn(
      lightpandaPath,
      ['fetch', '--dump', 'markdown', '--strip_mode', 'full', url],
      { timeout: LIGHTPANDA_TIMEOUT }
    )
    let output = ''
    let errorOutput = ''
    let settled = false
    const settle = (r: ToolResult) => {
      if (settled) return
      settled = true
      resolve(r)
    }
    proc.stdout.on('data', (d: Buffer) => {
      output += d.toString()
    })
    proc.stderr.on('data', (d: Buffer) => {
      errorOutput += d.toString()
    })
    proc.on('close', () => {
      if (output.trim()) {
        const content = output.trim()
        const titleMatch = content.match(/^#\s+(.+)$/m)
        const title = titleMatch ? titleMatch[1].trim() : hostnameOf(url)
        settle({
          output: `Title: ${title}\nURL: ${url}\n\n${content}`,
          isError: false,
        })
      } else {
        settle({
          error: `Lightpanda failed: ${errorOutput.slice(0, 300) || 'no output'}`,
          isError: true,
        })
      }
    })
    proc.on('error', (err) => settle({ error: `Lightpanda error: ${err.message}`, isError: true }))
  })
}

async function fetchHttp(url: string): Promise<ToolResult> {
  try {
    logger.info(`[web_fetch] HTTP: ${url}`)
    const response = await net.fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,text/plain,application/json',
        'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8',
      },
    })
    if (!response.ok) {
      return { error: `HTTP ${response.status} fetching ${url}`, isError: true }
    }
    const contentType = response.headers.get('content-type') || ''
    const raw = await response.text()
    let title = hostnameOf(url)
    let text = raw
    if (contentType.includes('html') || raw.trimStart().startsWith('<')) {
      title = extractTitle(raw) || title
      text = stripHtml(raw)
    } else if (contentType.includes('json')) {
      try {
        text = JSON.stringify(JSON.parse(raw), null, 2)
      } catch {
        text = raw
      }
    }
    return {
      output: `Title: ${title}\nURL: ${url}\n\n${text.trim()}`,
      isError: false,
    }
  } catch (err: any) {
    return { error: `Fetch failed: ${err.message}`, isError: true }
  }
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  return m ? m[1].replace(/\s+/g, ' ').trim() : ''
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

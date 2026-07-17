/**
 * Web search + fetch (Claude Code–inspired).
 *
 * Backends (zero-config):
 * - web_search: Brave if key stored, else multi-fallback DuckDuckGo (JSON + HTML)
 * - web_browse: HTTP fetch; optional Lightpanda if binary on disk
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

// ── Tool definitions ──────────────────────────────────────────────────

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
        description:
          'Search query. For stocks/tickers, search the EXACT symbol first (e.g. "DRAM stock ticker", "DRAM NASDAQ", "DRAM share price"), not a related company unless the exact ticker returns nothing.',
      },
      maxResults: {
        type: 'number',
        description: `Max results (default 6, max ${MAX_SEARCH_RESULTS})`,
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
          'What to extract from the page (e.g. "current price and day change"). Helps focus long pages.',
      },
    },
    required: ['url'],
  },
}

function buildWebSearchDescription(): string {
  const monthYear = getCurrentMonthYear()
  return [
    'Search the web for up-to-date information beyond your knowledge cutoff.',
    'Use for current events, stock/ticker quotes, latest versions, and uncertain facts.',
    'Skip for greetings, pure math/logic, and follow-ups already answered in thread.',
    '',
    'TICKERS & SECURITIES:',
    '- Treat short uppercase codes (e.g. DRAM, MU, AAPL) and user-given prices as likely securities.',
    '- First query the EXACT symbol the user named (e.g. "DRAM stock", "DRAM ticker symbol", "DRAM share price USD").',
    '- Do NOT replace the user ticker with a related company (e.g. do not analyze Micron/MU when the user asked DRAM) unless search proves DRAM is not a listed symbol or the user asked about the industry.',
    '- Include exchange context when given (US/美股, HK, CN).',
    '',
    'CRITICAL — after answering from search you MUST end with a Sources section of markdown links:',
    '  Sources:',
    '  - [Title](https://example.com/1)',
    '',
    `Current month is ${monthYear}. Prefer this year in queries for recent data.`,
    'Prefer 2–4 focused searches; if first results are weak, refine the query (add "stock", "ticker", exchange).',
  ].join('\n')
}

function buildWebFetchDescription(): string {
  return [
    'Fetch a URL and return readable page text (HTML → plain text).',
    'Use after web_search for promising quote/news links, or when the user provides a URL.',
    'Optional `prompt` focuses extraction on long pages.',
    'Do not re-fetch the same path in one turn. Read-only.',
  ].join(' ')
}

// ── Execution ─────────────────────────────────────────────────────────

export async function executeWebSearch(query: string, maxResults = 6): Promise<ToolResult> {
  const q = (query || '').trim()
  if (q.length < 2) {
    return { error: 'query must be at least 2 characters', isError: true }
  }
  const limit = Math.min(Math.max(1, maxResults || 6), MAX_SEARCH_RESULTS)
  const errors: string[] = []

  // 1) Brave if configured
  try {
    const config = getAiToolsConfigRaw()
    const braveKey = config?.webSearch?.braveApiKey?.trim()
    if (braveKey) {
      const brave = await searchBrave(q, braveKey, limit)
      if (!brave.isError && hasUsefulResults(brave.output || '')) return brave
      if (brave.isError) errors.push(`Brave: ${brave.error}`)
    }
  } catch (err: any) {
    errors.push(`Brave: ${err?.message || err}`)
  }

  // 2) DuckDuckGo Instant Answer JSON (stable API, no scraping)
  try {
    const ddgJson = await searchDuckDuckGoJson(q, limit)
    if (!ddgJson.isError && hasUsefulResults(ddgJson.output || '')) return ddgJson
    if (ddgJson.isError) errors.push(`DDG-JSON: ${ddgJson.error}`)
  } catch (err: any) {
    errors.push(`DDG-JSON: ${err?.message || err}`)
  }

  // 3) DuckDuckGo HTML scrape (best-effort)
  try {
    const ddgHtml = await searchDuckDuckGoHtml(q, limit)
    if (!ddgHtml.isError && hasUsefulResults(ddgHtml.output || '')) return ddgHtml
    if (ddgHtml.isError) errors.push(`DDG-HTML: ${ddgHtml.error}`)
    if (!ddgHtml.isError && ddgHtml.output) return ddgHtml // even empty-ish structured ok
  } catch (err: any) {
    errors.push(`DDG-HTML: ${err?.message || err}`)
  }

  // 4) Wikipedia OpenSearch as last soft fallback
  try {
    const wiki = await searchWikipedia(q, Math.min(limit, 5))
    if (!wiki.isError && hasUsefulResults(wiki.output || '')) return wiki
    if (wiki.isError) errors.push(`Wikipedia: ${wiki.error}`)
  } catch (err: any) {
    errors.push(`Wikipedia: ${err?.message || err}`)
  }

  logger.error('[web_search] all backends failed for:', q, errors)
  return {
    output:
      `No search results for "${q}". Backends tried: ${errors.join('; ') || 'none'}.\n` +
      `Try a more specific query (e.g. add "stock ticker", exchange, or company full name).`,
    isError: false, // soft failure so the model can still answer / refine
  }
}

function hasUsefulResults(output: string): boolean {
  if (!output || output.includes('No search results')) return false
  // At least one markdown link or URL
  return /\[[^\]]+\]\(https?:\/\//.test(output) || /https?:\/\/\S+/.test(output)
}

export async function executeWebFetch(url: string, prompt?: string): Promise<ToolResult> {
  let target = (url || '').trim()
  if (!target) return { error: 'url is required', isError: true }

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

  // jina reader proxy as last resort for blocked HTML
  if (result.isError) {
    const jina = await fetchHttp(`https://r.jina.ai/${target}`)
    if (!jina.isError) result = jina
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

async function searchDuckDuckGoJson(query: string, maxResults: number): Promise<ToolResult> {
  logger.info(`[web_search] DDG-JSON: "${query}"`)
  const url =
    `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}` +
    `&format=json&no_html=1&skip_disambig=1`
  const response = await net.fetch(url, {
    headers: {
      'User-Agent': 'ClawBench/1.0 (AI assistant; +https://github.com/mblackcat/clawbench)',
      Accept: 'application/json',
    },
  })
  if (!response.ok) {
    return { error: `DDG JSON HTTP ${response.status}`, isError: true }
  }
  const data = (await response.json()) as any
  const results: Array<{ title: string; url: string; snippet: string }> = []

  if (data.AbstractText && data.AbstractURL) {
    results.push({
      title: data.Heading || data.AbstractSource || 'Summary',
      url: data.AbstractURL,
      snippet: data.AbstractText,
    })
  }
  if (data.Answer && data.AnswerType) {
    results.push({
      title: `Answer (${data.AnswerType})`,
      url: data.AbstractURL || data.Redirect || '',
      snippet: String(data.Answer).replace(/<[^>]+>/g, ''),
    })
  }
  const topics = [...(data.RelatedTopics || [])]
  for (const t of topics) {
    if (results.length >= maxResults) break
    if (t.Topics && Array.isArray(t.Topics)) {
      for (const sub of t.Topics) {
        if (results.length >= maxResults) break
        if (sub.FirstURL && sub.Text) {
          results.push({
            title: String(sub.Text).split(' - ')[0].slice(0, 120),
            url: sub.FirstURL,
            snippet: sub.Text,
          })
        }
      }
    } else if (t.FirstURL && t.Text) {
      results.push({
        title: String(t.Text).split(' - ')[0].slice(0, 120),
        url: t.FirstURL,
        snippet: t.Text,
      })
    }
  }
  if (data.Results && Array.isArray(data.Results)) {
    for (const r of data.Results) {
      if (results.length >= maxResults) break
      if (r.FirstURL && r.Text) {
        results.push({ title: r.Text.slice(0, 120), url: r.FirstURL, snippet: r.Text })
      }
    }
  }

  if (results.length === 0) {
    return { output: `No search results found for: "${query}"`, isError: false }
  }
  return { output: formatSearchResults(query, results.slice(0, maxResults)), isError: false }
}

async function searchDuckDuckGoHtml(query: string, maxResults: number): Promise<ToolResult> {
  logger.info(`[web_search] DDG-HTML: "${query}"`)
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
  const response = await net.fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  })
  if (!response.ok) {
    return { error: `Search request failed: ${response.status}`, isError: true }
  }
  const html = await response.text()
  const results: Array<{ title: string; url: string; snippet: string }> = []

  // Pattern A: classic result__a + result__snippet
  const reA =
    /<a[^>]+class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|td)>)/gi
  let match: RegExpExecArray | null
  while ((match = reA.exec(html)) !== null && results.length < maxResults) {
    const item = normalizeDdgHit(match[1], match[2], match[3])
    if (item) results.push(item)
  }

  // Pattern B: result blocks with uddg only
  if (results.length === 0) {
    const reB = /uddg=([^&"]+)[^>]*>[\s\S]*?>([\s\S]*?)<\/a>/gi
    while ((match = reB.exec(html)) !== null && results.length < maxResults) {
      try {
        const u = decodeURIComponent(match[1])
        const title = match[2].replace(/<[^>]*>/g, '').trim()
        if (title && u.startsWith('http')) {
          results.push({ title, url: u, snippet: '' })
        }
      } catch { /* skip */ }
    }
  }

  if (results.length === 0) {
    return { output: `No search results found for: "${query}"`, isError: false }
  }
  return { output: formatSearchResults(query, results), isError: false }
}

function normalizeDdgHit(
  rawUrl: string,
  rawTitle: string,
  rawSnippet: string
): { title: string; url: string; snippet: string } | null {
  const title = (rawTitle || '').replace(/<[^>]*>/g, '').trim()
  const snippet = (rawSnippet || '').replace(/<[^>]*>/g, '').trim()
  let finalUrl = rawUrl || ''
  const uddgMatch = finalUrl.match(/[?&]uddg=([^&]+)/)
  if (uddgMatch) {
    try {
      finalUrl = decodeURIComponent(uddgMatch[1])
    } catch { /* keep */ }
  }
  if (!title || !finalUrl) return null
  if (!finalUrl.startsWith('http')) return null
  return { title, url: finalUrl, snippet }
}

async function searchBrave(query: string, apiKey: string, maxResults: number): Promise<ToolResult> {
  logger.info(`[web_search] Brave: "${query}"`)
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
}

async function searchWikipedia(query: string, maxResults: number): Promise<ToolResult> {
  logger.info(`[web_search] Wikipedia: "${query}"`)
  const url =
    `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}` +
    `&limit=${maxResults}&namespace=0&format=json`
  const response = await net.fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'ClawBench/1.0' },
  })
  if (!response.ok) return { error: `Wikipedia HTTP ${response.status}`, isError: true }
  const data = (await response.json()) as any[]
  // [query, titles[], descriptions[], urls[]]
  const titles: string[] = data[1] || []
  const descs: string[] = data[2] || []
  const urls: string[] = data[3] || []
  if (!titles.length) {
    return { output: `No search results found for: "${query}"`, isError: false }
  }
  const results = titles.map((title, i) => ({
    title,
    url: urls[i] || '',
    snippet: descs[i] || '',
  }))
  return { output: formatSearchResults(query, results), isError: false }
}

/** Claude Code–friendly formatting with markdown links for Sources sections. */
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
    `\n\n(When answering, cite sources as markdown links in a final Sources: section. Prefer the user's exact ticker/name over related substitutes.)`
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
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
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

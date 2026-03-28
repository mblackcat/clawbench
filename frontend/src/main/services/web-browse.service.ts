import { net } from 'electron'
import { spawn } from 'child_process'
import * as logger from '../utils/logger'
import type { ToolResult } from './tool-executor.service'

const MAX_CONTENT_LENGTH = 8000
const LIGHTPANDA_TIMEOUT = 20000

export async function executeWebBrowse(
  url: string,
  config: { engine: string; lightpandaPath: string }
): Promise<ToolResult> {
  logger.info(`[WebBrowse] Browsing: ${url}`)

  if (config.engine === 'lightpanda' && config.lightpandaPath) {
    const result = await browseLightpanda(url, config.lightpandaPath)
    // If Lightpanda succeeded, return it; otherwise fall back to HTTP
    if (!result.isError) {
      return result
    }
    logger.warn(`[WebBrowse] Lightpanda failed, falling back to HTTP: ${result.error}`)
  }

  return browseHttp(url)
}

async function browseLightpanda(url: string, lightpandaPath: string): Promise<ToolResult> {
  return new Promise((resolve) => {
    // Use --dump markdown for clean text output, --strip_mode full to remove JS/CSS/images
    const proc = spawn(lightpandaPath, [
      'fetch',
      '--dump', 'markdown',
      '--strip_mode', 'full',
      url
    ], { timeout: LIGHTPANDA_TIMEOUT })

    let output = ''
    let errorOutput = ''
    let settled = false

    const settle = (result: ToolResult) => {
      if (settled) return
      settled = true
      resolve(result)
    }

    proc.stdout.on('data', (data: Buffer) => { output += data.toString() })
    proc.stderr.on('data', (data: Buffer) => { errorOutput += data.toString() })

    proc.on('close', (code) => {
      // Lightpanda may output warnings on stderr but still produce valid output
      if (output.trim()) {
        const content = output.trim().substring(0, MAX_CONTENT_LENGTH)
        // Try to extract title from first markdown heading
        const titleMatch = content.match(/^#\s+(.+)$/m)
        const title = titleMatch ? titleMatch[1].trim() : extractTitleFromUrl(url)
        logger.info(`[WebBrowse] Lightpanda OK: ${url} (${content.length} chars)`)
        settle({
          output: `Title: ${title}\nURL: ${url}\n\n${content}`,
          isError: false
        })
      } else {
        // No output at all — treat as failure
        const errMsg = errorOutput.substring(0, 500) || `exit code ${code}`
        logger.warn(`[WebBrowse] Lightpanda no output: ${errMsg}`)
        settle({ error: `Lightpanda failed: ${errMsg}`, isError: true })
      }
    })

    proc.on('error', (err) => {
      logger.error(`[WebBrowse] Lightpanda spawn error: ${err.message}`)
      settle({ error: `Lightpanda error: ${err.message}`, isError: true })
    })
  })
}

async function browseHttp(url: string): Promise<ToolResult> {
  try {
    logger.info(`[WebBrowse] HTTP fetch: ${url}`)
    const response = await net.fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8'
      }
    })
    if (!response.ok) {
      return { error: `HTTP ${response.status} fetching ${url}`, isError: true }
    }
    const html = await response.text()
    const title = extractTitle(html)
    const text = stripHtml(html)
    const content = text.substring(0, MAX_CONTENT_LENGTH)
    logger.info(`[WebBrowse] HTTP OK: ${url} (${content.length} chars)`)
    return {
      output: `Title: ${title}\nURL: ${url}\n\n${content}`,
      isError: false
    }
  } catch (err: any) {
    logger.error(`[WebBrowse] HTTP failed: ${err.message}`)
    return { error: `Failed to browse ${url}: ${err.message}`, isError: true }
  }
}

function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  return match ? match[1].replace(/\s+/g, ' ').trim() : extractTitleFromUrl('')
}

function extractTitleFromUrl(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return '(no title)'
  }
}

function stripHtml(html: string): string {
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
  text = text.replace(/<[^>]*>/g, ' ')
  text = text.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;/g, "'")
  text = text.replace(/\s+/g, ' ').trim()
  return text
}

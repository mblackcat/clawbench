import { exec } from 'child_process'
import { net } from 'electron'
import * as logger from '../utils/logger'
import { executeImageGeneration, executeImageEdit } from './image-gen.service'
import { getAiToolsConfigRaw } from '../store/settings.store'
import { executeWebBrowse } from './web-browse.service'

export interface ToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, any>
  source: 'builtin' | 'mcp'
  mcpServerId?: string
}

export interface ToolResult {
  output?: string
  error?: string
  isError: boolean
}

/**
 * Built-in command executor tool
 */
export const COMMAND_EXECUTOR_TOOL: ToolDefinition = {
  name: 'execute_command',
  description:
    'Execute a shell command on the local machine. Use this to run scripts, check file contents, install packages, or perform other system operations.',
  inputSchema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The shell command to execute',
      },
      cwd: {
        type: 'string',
        description: 'Working directory for the command (optional)',
      },
    },
    required: ['command'],
  },
  source: 'builtin',
}

const COMMAND_TIMEOUT = 30000 // 30 seconds
const MAX_OUTPUT_SIZE = 1024 * 1024 // 1MB

/**
 * Execute a shell command and return the result
 */
export function executeCommand(
  command: string,
  cwd?: string
): Promise<ToolResult> {
  return new Promise((resolve) => {
    logger.info(`Executing command: ${command}${cwd ? ` (cwd: ${cwd})` : ''}`)

    exec(
      command,
      {
        timeout: COMMAND_TIMEOUT,
        maxBuffer: MAX_OUTPUT_SIZE,
        cwd: cwd || undefined,
        shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/bash',
      },
      (error, stdout, stderr) => {
        if (error) {
          const output = [stdout, stderr, error.message].filter(Boolean).join('\n')
          logger.error(`Command failed: ${command}`, error)
          resolve({
            output: output.substring(0, MAX_OUTPUT_SIZE),
            error: error.message,
            isError: true,
          })
          return
        }

        const output = [stdout, stderr].filter(Boolean).join('\n')
        resolve({
          output: output.substring(0, MAX_OUTPUT_SIZE),
          isError: false,
        })
      }
    )
  })
}

/**
 * Execute web search via DuckDuckGo HTML and parse results
 */
async function executeWebSearch(query: string, maxResults = 5): Promise<ToolResult> {
  const config = getAiToolsConfigRaw()
  if (config.webSearch.provider === 'brave' && config.webSearch.braveApiKey) {
    return executeBraveSearch(query, config.webSearch.braveApiKey, maxResults)
  }
  return executeDuckDuckGoSearch(query, maxResults)
}

async function executeDuckDuckGoSearch(query: string, maxResults = 5): Promise<ToolResult> {
  logger.info(`Web search: "${query}"`)
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
    const response = await net.fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    })
    if (!response.ok) {
      return { error: `Search request failed: ${response.status}`, isError: true }
    }
    const html = await response.text()

    // Parse results from DuckDuckGo HTML
    const results: Array<{ title: string; url: string; snippet: string }> = []
    const resultRegex = /<a[^>]+class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g
    let match: RegExpExecArray | null
    while ((match = resultRegex.exec(html)) !== null && results.length < maxResults) {
      const rawUrl = match[1]
      const title = match[2].replace(/<[^>]*>/g, '').trim()
      const snippet = match[3].replace(/<[^>]*>/g, '').trim()
      // DuckDuckGo URLs are redirect links, extract actual URL
      let finalUrl = rawUrl
      const uddgMatch = rawUrl.match(/[?&]uddg=([^&]+)/)
      if (uddgMatch) {
        finalUrl = decodeURIComponent(uddgMatch[1])
      }
      if (title && snippet) {
        results.push({ title, url: finalUrl, snippet })
      }
    }

    if (results.length === 0) {
      return { output: `No search results found for: "${query}"`, isError: false }
    }

    const formatted = results
      .map((r, i) => `[${i + 1}] ${r.title}\n    URL: ${r.url}\n    ${r.snippet}`)
      .join('\n\n')

    return { output: `Search results for "${query}":\n\n${formatted}`, isError: false }
  } catch (err: any) {
    logger.error('Web search failed:', err)
    return { error: `Web search failed: ${err.message}`, isError: true }
  }
}

async function executeBraveSearch(query: string, apiKey: string, maxResults = 5): Promise<ToolResult> {
  logger.info(`Brave search: "${query}"`)
  try {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${maxResults}`
    const response = await net.fetch(url, {
      headers: {
        'X-Subscription-Token': apiKey,
        'Accept': 'application/json',
        'Cache-Control': 'no-cache',
        'Accept-Encoding': 'gzip'
      }
    })
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      logger.error(`Brave search failed: HTTP ${response.status}`, body)
      return { error: `Brave search failed: ${response.status} ${body}`, isError: true }
    }
    const data = await response.json() as any
    const results = (data.web?.results || []).slice(0, maxResults)
    if (results.length === 0) {
      return { output: `No search results found for: "${query}"`, isError: false }
    }
    const formatted = results
      .map((r: any, i: number) => {
        const snippets = [r.description, ...(r.extra_snippets || [])].filter(Boolean).join(' | ')
        return `[${i + 1}] ${r.title}\n    URL: ${r.url}\n    ${snippets}`
      })
      .join('\n\n')
    return { output: `Search results for "${query}":\n\n${formatted}`, isError: false }
  } catch (err: any) {
    logger.error('Brave search failed:', err)
    return { error: `Brave search failed: ${err.message}`, isError: true }
  }
}

/**
 * Execute a tool by name and return result
 */
export async function executeTool(
  toolName: string,
  input: Record<string, any>
): Promise<ToolResult> {
  if (toolName === 'execute_command') {
    return executeCommand(input.command, input.cwd)
  }

  if (toolName === 'generate_image') {
    return executeImageGeneration(input)
  }

  if (toolName === 'edit_image') {
    return executeImageEdit(input)
  }

  if (toolName === 'web_search') {
    return executeWebSearch(input.query, input.maxResults)
  }

  if (toolName === 'web_browse') {
    const config = getAiToolsConfigRaw()
    return executeWebBrowse(input.url, config.webBrowse)
  }

  return {
    error: `Unknown built-in tool: ${toolName}`,
    isError: true,
  }
}

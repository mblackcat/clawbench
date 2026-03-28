/**
 * Feishu Tools Service — standalone service for Feishu document/messaging tools.
 * Decoupled from InternalToolProvider / MCP pattern.
 *
 * Uses feishu-cli (https://github.com/riba2534/feishu-cli) for actual operations.
 */

import { execFile } from 'child_process'
import { promisify } from 'util'
import * as path from 'path'
import * as fs from 'fs'
import { app } from 'electron'
import * as logger from '../utils/logger'
import { getIMConfig } from './ai-workbench.service'
import { getAiToolsConfigRaw } from '../store/settings.store'
import { isFeishuUser } from '../store/auth.store'
import { getValidFeishuAccessToken } from './auth.service'

const execFileAsync = promisify(execFile)

export interface FeishuToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, any>
}

export interface FeishuToolResult {
  content: string
  isError: boolean
}

// ── feishu-cli binary detection ──

let cachedCliPath: string | null = null
let cliChecked = false

async function findFeishuCli(): Promise<string | null> {
  if (cliChecked) return cachedCliPath

  // Priority 1: configured path from settings
  try {
    const config = getAiToolsConfigRaw()
    const configured = config?.feishuKits?.cliPath
    if (configured) {
      if (fs.existsSync(configured)) {
        cachedCliPath = configured
        cliChecked = true
        return cachedCliPath
      }
    }
  } catch { /* ignore */ }

  // Priority 2: PATH lookup
  try {
    const { stdout } = await execFileAsync('which', ['feishu-cli'])
    cachedCliPath = stdout.trim() || null
  } catch {
    cachedCliPath = null
  }
  cliChecked = true
  return cachedCliPath
}

/** Reset cache so next call re-checks (useful after install). */
export function resetFeishuCliCache(): void {
  cachedCliPath = null
  cliChecked = false
}

// ── Tool definitions ──

const TOOL_DEFS: FeishuToolDefinition[] = [
  {
    name: 'feishu_read_doc',
    description:
      'Export a Feishu document or wiki page as a local markdown file. ' +
      'This tool downloads the document content and saves it as a .md file in a local directory. ' +
      'The return value is the local file path. After calling this tool, you MUST read the exported local file to get the actual document content. ' +
      'Accepts any Feishu URL (doc, wiki, docx) or a document/node token. Automatically detects wiki URLs.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Feishu document URL, wiki URL, or document_id/node_token' },
      },
      required: ['url'],
    },
  },
  {
    name: 'feishu_create_doc',
    description: 'Create a new empty Feishu document with a title. Optionally specify a folder. To create a doc with markdown content, use feishu_import_doc instead.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Document title' },
        folder: { type: 'string', description: 'Target folder token (optional)' },
      },
      required: ['title'],
    },
  },
  {
    name: 'feishu_import_doc',
    description: 'Import markdown content to create a new Feishu document or update an existing one.',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'Markdown content to import' },
        title: { type: 'string', description: 'Document title (required when creating new doc)' },
        documentId: { type: 'string', description: 'Existing document ID to update (optional, creates new if omitted)' },
      },
      required: ['content'],
    },
  },
  {
    name: 'feishu_search_docs',
    description: 'Search Feishu documents by keyword. Requires User Access Token (feishu-cli auth login).',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search keyword' },
      },
      required: ['query'],
    },
  },
  {
    name: 'feishu_send_message',
    description: 'Send a text message to a Feishu chat group or user.',
    inputSchema: {
      type: 'object',
      properties: {
        receiveIdType: { type: 'string', description: 'Receiver type: chat_id, open_id, user_id, email', enum: ['chat_id', 'open_id', 'user_id', 'email'] },
        receiveId: { type: 'string', description: 'Receiver identifier (chat ID, open ID, user ID, or email)' },
        text: { type: 'string', description: 'Message text content' },
      },
      required: ['receiveIdType', 'receiveId', 'text'],
    },
  },
  {
    name: 'feishu_search_messages',
    description: 'Search Feishu messages by keyword. Requires User Access Token (feishu-cli auth login).',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search keyword' },
      },
      required: ['query'],
    },
  },
  {
    name: 'feishu_list_wiki_spaces',
    description: 'List available Feishu wiki spaces.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'feishu_export_wiki',
    description:
      'Export a Feishu wiki node as a local markdown file. ' +
      'This tool downloads the wiki content and saves it as a .md file in a local directory. ' +
      'The return value is the local file path. After calling this tool, you MUST read the exported local file to get the actual content. ' +
      'Accepts a wiki URL or node token.',
    inputSchema: {
      type: 'object',
      properties: {
        token: { type: 'string', description: 'Wiki node token or wiki URL' },
      },
      required: ['token'],
    },
  },
  {
    name: 'feishu_sheet_read',
    description: 'Read data from a Feishu spreadsheet. Provide the spreadsheet token and a cell range.',
    inputSchema: {
      type: 'object',
      properties: {
        token: { type: 'string', description: 'Spreadsheet token or URL' },
        range: { type: 'string', description: 'Cell range, e.g. "Sheet1!A1:C10"' },
      },
      required: ['token', 'range'],
    },
  },
]

// ── Export directory for Feishu documents ──

const FEISHU_EXPORT_DIR = path.join(app.getPath('userData'), 'feishu-exports')

function ensureExportDir(): string {
  if (!fs.existsSync(FEISHU_EXPORT_DIR)) {
    fs.mkdirSync(FEISHU_EXPORT_DIR, { recursive: true })
  }
  return FEISHU_EXPORT_DIR
}

/** Extract a short identifier from a Feishu URL or token for use as filename */
function extractDocId(urlOrToken: string): string {
  // Try to extract the last path segment token from URLs
  const match = urlOrToken.match(/(?:docx?|wiki|sheets?)\/([A-Za-z0-9_-]+)/)
  if (match) return match[1]
  // Already a token
  return urlOrToken.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 40)
}

// ── Helper: run feishu-cli ──

/**
 * Determine Feishu auth mode:
 * - 'feishu_user': user logged in via Feishu OAuth → use their UAT
 * - 'local_bot': local user with IM bot credentials → use app_id/app_secret
 * - 'unavailable': no valid credentials
 */
type FeishuAuthMode = 'feishu_user' | 'local_bot' | 'unavailable'

function getFeishuAuthMode(): FeishuAuthMode {
  if (isFeishuUser()) return 'feishu_user'

  try {
    const imConfig = getIMConfig()
    const { appId, appSecret } = imConfig.feishu
    if (appId && appSecret) return 'local_bot'
  } catch { /* no IM config */ }

  return 'unavailable'
}

/** Check if Feishu tools are available for the current user */
export function isFeishuToolsAvailable(): { available: boolean; reason: string; mode: FeishuAuthMode } {
  const mode = getFeishuAuthMode()
  if (mode === 'unavailable') {
    return {
      available: false,
      reason: 'Feishu tools require either Feishu login or IM bot credentials configured.',
      mode,
    }
  }
  return { available: true, reason: '', mode }
}

async function runFeishuCli(args: string[]): Promise<FeishuToolResult> {
  const cliPath = await findFeishuCli()
  if (!cliPath) {
    return {
      content:
        'feishu-cli is not installed. Install it with:\n\ncurl -fsSL https://raw.githubusercontent.com/riba2534/feishu-cli/main/install.sh | bash\n\nThen try again.',
      isError: true,
    }
  }

  const authMode = getFeishuAuthMode()

  if (authMode === 'unavailable') {
    return {
      content: 'Feishu tools are not available. Please log in with Feishu or configure IM bot credentials.',
      isError: true,
    }
  }

  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
  }

  if (authMode === 'feishu_user') {
    // Feishu OAuth user: use their UAT (auto-refreshed)
    const uat = await getValidFeishuAccessToken()
    if (uat) {
      env.FEISHU_USER_ACCESS_TOKEN = uat
    }
    // Also set app credentials from IM config if available (some operations may need them)
    try {
      const imConfig = getIMConfig()
      if (imConfig.feishu.appId) env.FEISHU_APP_ID = imConfig.feishu.appId
      if (imConfig.feishu.appSecret) env.FEISHU_APP_SECRET = imConfig.feishu.appSecret
    } catch { /* no IM config, UAT is sufficient */ }
  } else {
    // Local user with IM bot credentials
    const imConfig = getIMConfig()
    env.FEISHU_APP_ID = imConfig.feishu.appId
    env.FEISHU_APP_SECRET = imConfig.feishu.appSecret
  }

  try {
    const { stdout, stderr } = await execFileAsync(cliPath, args, {
      env,
      timeout: 30_000,
      maxBuffer: 10 * 1024 * 1024, // 10 MB
    })
    const output = stdout.trim() || stderr.trim() || '(no output)'
    return { content: output, isError: false }
  } catch (err: any) {
    const msg = err.stderr?.trim() || err.message || 'Unknown error'
    // Add helpful hints based on auth mode
    if (msg.includes('99991679') || msg.includes('Unauthorized')) {
      if (authMode === 'feishu_user') {
        return {
          content: `${msg}\n\n` +
            'Hint: Your Feishu session may have expired. Please log out and log in again with Feishu to refresh your access token.',
          isError: true,
        }
      }
      return {
        content: `${msg}\n\n` +
          'Hint: Bot credentials are unauthorized. Please check your IM App ID / App Secret configuration.',
        isError: true,
      }
    }
    if (msg.includes('131006') || msg.includes('permission denied') || msg.includes('Permission denied')) {
      if (authMode === 'local_bot') {
        return {
          content: `${msg}\n\n` +
            'Hint: The bot does not have access to this resource. Add the bot to the document collaborators, or log in with Feishu to use your personal permissions.',
          isError: true,
        }
      }
      return {
        content: `${msg}\n\n` +
          'Hint: You do not have permission to access this resource in Feishu.',
        isError: true,
      }
    }
    return { content: `feishu-cli error: ${msg}`, isError: true }
  }
}

// ── Standalone Service ──

export class FeishuToolsService {
  listTools(): FeishuToolDefinition[] {
    return TOOL_DEFS
  }

  async executeTool(toolName: string, input: Record<string, any>): Promise<FeishuToolResult> {
    switch (toolName) {
      case 'feishu_read_doc': {
        // Auto-detect wiki URLs and route to wiki export
        const urlStr = String(input.url)
        const exportDir = ensureExportDir()
        const docId = extractDocId(urlStr)
        const outputFile = path.join(exportDir, `${docId}.md`)
        const isWiki = urlStr.includes('/wiki/')
        const exportArgs = isWiki
          ? ['wiki', 'export', urlStr, '-o', outputFile]
          : ['doc', 'export', urlStr, '-o', outputFile]
        const result = await runFeishuCli(exportArgs)
        if (!result.isError) {
          // Return the file path so the AI agent knows where to read the content
          result.content = `Document exported successfully to local file:\n${outputFile}\n\nPlease read this file to view the document content.`
        }
        return result
      }

      case 'feishu_create_doc': {
        const args = ['doc', 'create', '--title', input.title]
        if (input.folder) args.push('--folder', input.folder)
        return runFeishuCli(args)
      }

      case 'feishu_import_doc': {
        // Write markdown to a temp file, then import
        const os = require('os')
        const tmpFile = path.join(os.tmpdir(), `feishu-import-${Date.now()}.md`)
        fs.writeFileSync(tmpFile, input.content, 'utf-8')
        const args = ['doc', 'import', tmpFile]
        if (input.title) args.push('--title', input.title)
        if (input.documentId) args.push('--document-id', input.documentId)
        try {
          const result = await runFeishuCli(args)
          fs.unlinkSync(tmpFile)
          return result
        } catch (err) {
          try { fs.unlinkSync(tmpFile) } catch { /* ignore */ }
          throw err
        }
      }

      case 'feishu_search_docs':
        return runFeishuCli(['search', 'docs', input.query])

      case 'feishu_send_message':
        return runFeishuCli([
          'msg', 'send',
          '--receive-id-type', input.receiveIdType,
          '--receive-id', input.receiveId,
          '--text', input.text
        ])

      case 'feishu_search_messages':
        return runFeishuCli(['search', 'messages', input.query])

      case 'feishu_list_wiki_spaces':
        return runFeishuCli(['wiki', 'spaces'])

      case 'feishu_export_wiki': {
        const wikiDir = ensureExportDir()
        const wikiId = extractDocId(input.token)
        const wikiOutputFile = path.join(wikiDir, `${wikiId}.md`)
        const wikiResult = await runFeishuCli(['wiki', 'export', input.token, '-o', wikiOutputFile])
        if (!wikiResult.isError) {
          wikiResult.content = `Wiki node exported successfully to local file:\n${wikiOutputFile}\n\nPlease read this file to view the document content.`
        }
        return wikiResult
      }

      case 'feishu_sheet_read':
        return runFeishuCli(['sheet', 'read', input.token, input.range])

      default:
        return { content: `Unknown feishu tool: ${toolName}`, isError: true }
    }
  }
}

// Singleton
let _instance: FeishuToolsService | null = null

export function getFeishuToolsService(): FeishuToolsService {
  if (!_instance) {
    _instance = new FeishuToolsService()
  }
  return _instance
}

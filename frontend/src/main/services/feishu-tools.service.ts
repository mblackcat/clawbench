/**
 * Feishu Tools Service — AI Chat tools powered by the official Lark/Feishu CLI
 * (https://github.com/larksuite/cli, binary: lark-cli).
 *
 * Completely independent of AI Coding IM remote-control (bot App ID/Secret).
 * Auth: Feishu OAuth login User Access Token (UAT) only — no per-user app setup.
 */

import { execFile } from 'child_process'
import { promisify } from 'util'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import * as logger from '../utils/logger'
import { getAiToolsConfigRaw } from '../store/settings.store'
import { isFeishuUser } from '../store/auth.store'
import { getValidFeishuAccessToken, ensureFeishuPlatformAppId } from './auth.service'

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

// ── lark-cli binary detection & Windows-safe invocation ──
//
// On Windows, npm installs three shims next to each other:
//   lark-cli      → #!/bin/sh  bash script (NOT runnable by CreateProcess → ENOENT)
//   lark-cli.cmd  → batch file (works with shell / cmd.exe)
//   lark-cli.ps1  → PowerShell
// `where.exe` often returns the bare `lark-cli` first, which is why chat fails
// while an interactive terminal (PowerShell/cmd resolves PATHEXT) works.
// Prefer .cmd, or better: spawn node + @larksuite/cli/scripts/run.js directly.

interface LarkCliInvocation {
  /** Path shown in settings / error messages */
  displayPath: string
  /** Executable for child_process */
  command: string
  /** Args prepended before the lark-cli subcommand args */
  prefixArgs: string[]
  shell: boolean
}

let cachedInvocation: LarkCliInvocation | null = null
let cliChecked = false

async function whichCommand(name: string): Promise<string | null> {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execFileAsync('where.exe', [name], { timeout: 5000 })
      const lines = stdout
        .trim()
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
      if (lines.length === 0) return null
      // Prefer Windows-native shims over the extensionless bash wrapper
      return (
        lines.find((l) => /\.cmd$/i.test(l)) ||
        lines.find((l) => /\.exe$/i.test(l)) ||
        lines.find((l) => /\.ps1$/i.test(l)) ||
        lines[0]
      )
    }
    const { stdout } = await execFileAsync('which', [name], { timeout: 5000 })
    return stdout.trim() || null
  } catch {
    return null
  }
}

/**
 * Upgrade a detected path to something CreateProcess can actually run on Windows.
 * Bare `lark-cli` (bash) exists on disk but always fails with ENOENT under execFile.
 */
function normalizeCliPath(raw: string): string | null {
  if (!raw) return null
  const p = raw.trim().replace(/^["']|["']$/g, '')
  if (!p) return null

  if (process.platform === 'win32') {
    // Explicit .cmd
    if (/\.cmd$/i.test(p) && fs.existsSync(p)) return p

    // Bare path or .ps1 → prefer sibling .cmd
    const asCmd = /\.ps1$/i.test(p) ? p.replace(/\.ps1$/i, '.cmd') : `${p}.cmd`
    if (fs.existsSync(asCmd)) return asCmd

    // Directory-local lark-cli.cmd (handles nvm folder + wrong filename casing)
    const dirCmd = path.join(path.dirname(p), 'lark-cli.cmd')
    if (fs.existsSync(dirCmd)) return dirCmd

    // Last resort: bare path still "exists" but is not runnable — keep it only if
    // we can later resolve run.js next to it
    if (fs.existsSync(p)) return p
    return null
  }

  return fs.existsSync(p) ? p : null
}

function candidateLarkCliPaths(): string[] {
  const home = os.homedir()
  const list: string[] = []
  if (process.platform === 'win32') {
    // npm global / nvm4w / classic nvm
    if (process.env.APPDATA) {
      list.push(path.join(process.env.APPDATA, 'npm', 'lark-cli.cmd'))
    }
    if (process.env.LOCALAPPDATA) {
      list.push(path.join(process.env.LOCALAPPDATA, 'npm', 'lark-cli.cmd'))
      // classic nvm-windows: %LOCALAPPDATA%\nvm\vX.Y.Z\
      const nvmRoot = path.join(process.env.LOCALAPPDATA, 'nvm')
      try {
        if (fs.existsSync(nvmRoot)) {
          for (const entry of fs.readdirSync(nvmRoot)) {
            if (entry.startsWith('v')) {
              list.push(path.join(nvmRoot, entry, 'lark-cli.cmd'))
            }
          }
        }
      } catch { /* ignore */ }
    }
    // nvm4w symlink dir
    list.push(path.join('C:', 'nvm4w', 'nodejs', 'lark-cli.cmd'))
  } else {
    list.push('/usr/local/bin/lark-cli')
    list.push(path.join(home, '.local', 'bin', 'lark-cli'))
    list.push('/opt/homebrew/bin/lark-cli')
    list.push(path.join(home, '.npm-global', 'bin', 'lark-cli'))
  }
  return list
}

/**
 * Build a reliable spawn invocation.
 * Prefer `node run.js` (avoids .cmd / PATHEXT / shell quirks entirely).
 */
function resolveInvocation(cliPath: string): LarkCliInvocation {
  const displayPath = cliPath
  const dir = path.dirname(cliPath)

  const runJsCandidates = [
    path.join(dir, 'node_modules', '@larksuite', 'cli', 'scripts', 'run.js'),
    // Some installs nest under lib/node_modules
    path.join(dir, 'lib', 'node_modules', '@larksuite', 'cli', 'scripts', 'run.js'),
  ]

  for (const runJs of runJsCandidates) {
    if (!fs.existsSync(runJs)) continue
    const localNode =
      process.platform === 'win32'
        ? path.join(dir, 'node.exe')
        : path.join(dir, 'node')
    const nodeCmd = fs.existsSync(localNode) ? localNode : 'node'
    return {
      displayPath,
      command: nodeCmd,
      prefixArgs: [runJs],
      shell: false,
    }
  }

  // Fallback: spawn the shim itself
  if (process.platform === 'win32') {
    // .cmd/.bat require shell; bare bash shims cannot run under CreateProcess
    return {
      displayPath,
      command: cliPath,
      prefixArgs: [],
      shell: true,
    }
  }

  return {
    displayPath,
    command: cliPath,
    prefixArgs: [],
    shell: false,
  }
}

async function findLarkCliInvocation(): Promise<LarkCliInvocation | null> {
  if (cliChecked) return cachedInvocation

  const tryPath = (raw: string | null | undefined): LarkCliInvocation | null => {
    if (!raw) return null
    const normalized = normalizeCliPath(raw)
    if (!normalized) return null
    return resolveInvocation(normalized)
  }

  // Priority 1: configured path from settings (may be bare bash shim — normalize)
  try {
    const config = getAiToolsConfigRaw()
    const configured = config?.feishuKits?.cliPath
    const inv = tryPath(configured)
    if (inv) {
      cachedInvocation = inv
      cliChecked = true
      return cachedInvocation
    }
  } catch { /* ignore */ }

  // Priority 2: PATH lookup (where.exe prefers .cmd)
  const fromPath = await whichCommand('lark-cli')
  {
    const inv = tryPath(fromPath)
    if (inv) {
      cachedInvocation = inv
      cliChecked = true
      return cachedInvocation
    }
  }

  // Priority 3: common install locations
  for (const p of candidateLarkCliPaths()) {
    const inv = tryPath(p)
    if (inv) {
      cachedInvocation = inv
      cliChecked = true
      return cachedInvocation
    }
  }

  cachedInvocation = null
  cliChecked = true
  return null
}

/** Reset cache so next call re-checks (useful after install). */
export function resetFeishuCliCache(): void {
  cachedInvocation = null
  cliChecked = false
}

/** Public detect helper for settings IPC */
export async function detectLarkCli(): Promise<{ found: boolean; path: string }> {
  resetFeishuCliCache()
  const inv = await findLarkCliInvocation()
  return { found: !!inv, path: inv?.displayPath || '' }
}

// ── Tool definitions ──

const TOOL_DEFS: FeishuToolDefinition[] = [
  {
    name: 'feishu_read_doc',
    description:
      'Fetch Feishu/Lark document content (doc, wiki page, or docx URL/token) as structured text. ' +
      'Use this to read documents the logged-in user can access.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Feishu document URL, wiki URL, or document token' },
      },
      required: ['url'],
    },
  },
  {
    name: 'feishu_create_doc',
    description: 'Create a new Feishu document with a title. Optionally include markdown content and a parent folder.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Document title' },
        content: { type: 'string', description: 'Optional markdown body' },
        folder: { type: 'string', description: 'Target folder token (optional)' },
      },
      required: ['title'],
    },
  },
  {
    name: 'feishu_import_doc',
    description: 'Import markdown content to create a new Feishu document or overwrite an existing one.',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'Markdown content to import' },
        title: { type: 'string', description: 'Document title (required when creating new doc)' },
        documentId: { type: 'string', description: 'Existing document URL/token to update (optional)' },
      },
      required: ['content'],
    },
  },
  {
    name: 'feishu_search_docs',
    description: 'Search Feishu docs, Wiki, and spreadsheets by keyword (user identity).',
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
    description: 'Send a text message to a Feishu chat or user as the logged-in user.',
    inputSchema: {
      type: 'object',
      properties: {
        receiveIdType: {
          type: 'string',
          description: 'Receiver type: chat_id or open_id/user_id',
          enum: ['chat_id', 'open_id', 'user_id'],
        },
        receiveId: { type: 'string', description: 'chat_id (oc_xxx) or user open_id (ou_xxx)' },
        text: { type: 'string', description: 'Message text content' },
      },
      required: ['receiveIdType', 'receiveId', 'text'],
    },
  },
  {
    name: 'feishu_search_messages',
    description: 'Search Feishu messages by keyword across chats (user identity).',
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
    description: 'List Feishu wiki spaces visible to the logged-in user.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'feishu_export_wiki',
    description: 'Fetch a Feishu wiki node / page content by URL or token.',
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
    description: 'Read data from a Feishu spreadsheet. Provide the spreadsheet URL/token and a cell range.',
    inputSchema: {
      type: 'object',
      properties: {
        token: { type: 'string', description: 'Spreadsheet token or URL' },
        range: { type: 'string', description: 'Cell range, e.g. "Sheet1!A1:C10" or "A1:C10"' },
      },
      required: ['token', 'range'],
    },
  },
]

// ── Auth: Feishu OAuth user only (no IM bot) ──

/** Check if Feishu tools are available for the current user */
export function isFeishuToolsAvailable(): { available: boolean; reason: string; mode: string } {
  // Kits must be enabled in settings
  try {
    const config = getAiToolsConfigRaw()
    if (!config?.feishuKits?.enabled) {
      return {
        available: false,
        reason: 'Feishu Kits is disabled. Enable it in Settings → AI Tools.',
        mode: 'disabled',
      }
    }
  } catch {
    return { available: false, reason: 'Settings unavailable', mode: 'disabled' }
  }

  if (!isFeishuUser()) {
    return {
      available: false,
      reason: 'Feishu Kits requires Feishu login. Please sign in with Feishu.',
      mode: 'unavailable',
    }
  }

  return { available: true, reason: '', mode: 'feishu_user' }
}

async function runLarkCli(args: string[]): Promise<FeishuToolResult> {
  const inv = await findLarkCliInvocation()
  if (!inv) {
    return {
      content:
        'lark-cli is not installed. Install it from Settings → AI Tools → Feishu Kits, or run:\n\n' +
        'npx @larksuite/cli@latest install',
      isError: true,
    }
  }

  if (!isFeishuUser()) {
    return {
      content: 'Feishu tools require Feishu login. Please log in with Feishu, then enable Feishu Kits in settings.',
      isError: true,
    }
  }

  const uat = await getValidFeishuAccessToken()
  if (!uat) {
    return {
      content:
        'Feishu access token is missing or expired. Please log out and log in again with Feishu to refresh authorization.',
      isError: true,
    }
  }

  // lark-cli requires APP_ID whenever USER_ACCESS_TOKEN is set
  // ("blocked by env: LARKSUITE_CLI_USER_ACCESS_TOKEN is set but LARKSUITE_CLI_APP_ID is missing")
  const appId = await ensureFeishuPlatformAppId()
  if (!appId) {
    return {
      content:
        'Platform Feishu App ID is missing. Please log out and log in again with Feishu, ' +
        'or check that the backend exposes /auth/feishu/public-config with a valid FEISHU_APP_ID.',
      isError: true,
    }
  }

  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    // Official lark-cli credential env vars (UAT + platform App ID, no secret)
    LARKSUITE_CLI_USER_ACCESS_TOKEN: uat,
    LARKSUITE_CLI_APP_ID: appId,
  }

  // Ensure --as user is present for user-identity operations
  const cliArgs = [...args]
  if (!cliArgs.includes('--as')) {
    cliArgs.push('--as', 'user')
  }

  const spawnArgs = [...inv.prefixArgs, ...cliArgs]

  try {
    logger.info(
      `[lark-cli] spawn command=${inv.command} shell=${inv.shell} display=${inv.displayPath} args=${spawnArgs.slice(0, 6).join(' ')}`
    )
    const { stdout, stderr } = await execFileAsync(inv.command, spawnArgs, {
      env,
      timeout: 60_000,
      maxBuffer: 10 * 1024 * 1024,
      shell: inv.shell,
      windowsHide: true,
    })
    const output = stdout.trim() || stderr.trim() || '(no output)'
    return { content: output, isError: false }
  } catch (err: any) {
    const code = err.code ? String(err.code) : ''
    const msg = (err.stderr?.trim() || err.stdout?.trim() || err.message || 'Unknown error') as string

    // Windows bare-shim ENOENT — give an actionable hint
    if (code === 'ENOENT' || /ENOENT/i.test(msg)) {
      return {
        content:
          `Failed to launch lark-cli (ENOENT).\n` +
          `Detected path: ${inv.displayPath}\n` +
          `Spawn: ${inv.command} ${spawnArgs[0] || ''}\n\n` +
          `On Windows, npm installs a non-runnable bash shim named "lark-cli". ` +
          `Please click Auto Detect in Settings → AI Tools → Feishu Kits to refresh the path ` +
          `(should resolve to lark-cli.cmd or node + run.js), or reinstall with:\n` +
          `npx @larksuite/cli@latest install`,
        isError: true,
      }
    }

    if (msg.includes('99991679') || /unauthori[sz]ed/i.test(msg) || (/token/i.test(msg) && /expir/i.test(msg))) {
      return {
        content:
          `${msg}\n\n` +
          'Hint: Your Feishu session may have expired. Please log out and log in again with Feishu to refresh your access token.',
        isError: true,
      }
    }
    if (msg.includes('131006') || /permission denied/i.test(msg)) {
      return {
        content: `${msg}\n\nHint: You do not have permission to access this resource in Feishu under your account.`,
        isError: true,
      }
    }
    return { content: `lark-cli error: ${msg}`, isError: true }
  }
}

// ── Standalone Service ──

export class FeishuToolsService {
  listTools(): FeishuToolDefinition[] {
    return TOOL_DEFS
  }

  async executeTool(toolName: string, input: Record<string, any>): Promise<FeishuToolResult> {
    switch (toolName) {
      case 'feishu_read_doc':
        return runLarkCli(['docs', '+fetch', '--doc', String(input.url)])

      case 'feishu_create_doc': {
        const args = ['docs', '+create', '--title', String(input.title)]
        if (input.content) args.push('--markdown', String(input.content))
        if (input.folder) args.push('--folder-token', String(input.folder))
        return runLarkCli(args)
      }

      case 'feishu_import_doc': {
        if (input.documentId) {
          return runLarkCli([
            'docs', '+update',
            '--doc', String(input.documentId),
            '--mode', 'overwrite',
            '--markdown', String(input.content),
          ])
        }
        const args = ['docs', '+create', '--markdown', String(input.content)]
        if (input.title) args.push('--title', String(input.title))
        return runLarkCli(args)
      }

      case 'feishu_search_docs':
        return runLarkCli(['docs', '+search', '--query', String(input.query)])

      case 'feishu_send_message': {
        const idType = String(input.receiveIdType || '')
        const args = ['im', '+messages-send', '--text', String(input.text)]
        if (idType === 'chat_id') {
          args.push('--chat-id', String(input.receiveId))
        } else {
          // open_id / user_id → --user-id
          args.push('--user-id', String(input.receiveId))
        }
        return runLarkCli(args)
      }

      case 'feishu_search_messages':
        return runLarkCli(['im', '+messages-search', '--query', String(input.query)])

      case 'feishu_list_wiki_spaces':
        return runLarkCli(['wiki', 'spaces', 'list'])

      case 'feishu_export_wiki':
        return runLarkCli(['docs', '+fetch', '--doc', String(input.token)])

      case 'feishu_sheet_read': {
        const token = String(input.token)
        const range = String(input.range)
        const args = ['sheets', '+read', '--range', range]
        if (/^https?:\/\//i.test(token)) {
          args.push('--url', token)
        } else {
          args.push('--spreadsheet-token', token)
        }
        return runLarkCli(args)
      }

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

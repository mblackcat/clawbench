import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import * as logger from '../utils/logger'
import { getAppDataPath } from '../utils/paths'
import { settingsStore } from '../store/settings.store'
import {
  ensureWorkspaceForWorkingDirInGroup,
  ensureGroupByName,
  createRuntimeSession,
  deleteSession,
  detectAvailableCLIs
} from './ai-coding.service'
import type { AIToolType, AICodingSession } from '../store/ai-coding.store'
import type { TerminalExecTarget } from './terminal-exec-mcp'

/**
 * AI Terminal assistant — "CLI Agent" mode.
 *
 * Coexists with the model-chat assistant in the renderer. Instead of a chat
 * stack, it reuses the AI Coding CLI session infrastructure (any installed &
 * enabled coding tool, run as a real PTY/TUI, or the Claude SDK chat surface).
 *
 * Sessions are grouped by *target machine*: every shell/DB session for the same
 * host converges on one working directory and therefore one AI Coding
 * workspace, collected under a dedicated "AI Terminal" group.
 *
 * Guidance (plus an optional snapshot of the live shell / DB context) is written
 * into that directory as CLAUDE.md / AGENTS.md, which the coding tools read as
 * project instructions.
 */

export type TerminalAssistantKind = 'shell' | 'db'

/**
 * The machine an assistant session targets. `key` is a stable identifier (local,
 * host:port, connection id ...); `label` is human-readable.
 */
export interface TerminalAssistantTarget {
  key: string
  label?: string
  isLocal?: boolean
}

/** Coding tools NOT usable as an interactive assistant (plain shell only). */
const EXCLUDED_TOOLS = new Set<string>(['terminal'])

/** Name of the AI Coding group that collects all terminal assistant workspaces. */
const ASSISTANT_GROUP_NAME = 'AI Terminal'

function assistantRootDir(): string {
  return path.join(getAppDataPath(), 'terminal-assistant-sessions')
}

function isEnglish(): boolean {
  try {
    return settingsStore.get('language') === 'en'
  } catch {
    return false
  }
}

/** Installed + enabled coding tools the terminal assistant can drive. */
export async function listTerminalAssistantTools(): Promise<
  Array<{ toolType: AIToolType; name: string; installed: boolean; version?: string }>
> {
  const detected = await detectAvailableCLIs()
  return detected
    .filter((c) => c.installed && !EXCLUDED_TOOLS.has(c.toolType))
    .map((c) => ({ toolType: c.toolType as AIToolType, name: c.name, installed: c.installed, version: c.version }))
}

interface GuidanceInput {
  kind: TerminalAssistantKind
  target: TerminalAssistantTarget
  contextSnapshot?: string
  /** True only for a Claude session with a live exec target (in-process MCP tools). */
  hasExecTools: boolean
}

/**
 * Guidance in Chinese. The key point is the *execution boundary*: the assistant
 * runs on the LOCAL machine while the terminal/DB it helps with may be remote.
 */
function buildGuidanceZh({ kind, target, contextSnapshot, hasExecTools }: GuidanceInput): string {
  const targetName = target.isLocal ? '本机' : `远程主机「${target.label || target.key}」`

  const execTools = hasExecTools
    ? kind === 'db'
      ? [
          '## 你已具备直接执行能力',
          '- 你配备了 run_sql_query（只读查询）与 run_sql_write（写操作）工具，会直接作用于用户当前的数据库连接（可能是远程数据库）。',
          '- 需要查看数据或执行 SQL 时，请直接调用这些工具，而不是让用户手动去执行。',
          '- 写操作（run_sql_write）有副作用，调用前先说明影响范围；工具调用需要用户确认。',
          ''
        ]
      : [
          '## 你已具备直接执行能力',
          '- 你配备了 run_terminal_command（执行命令）与 read_terminal_output（读取当前输出）工具，会直接作用于用户下方那个终端窗口（可能已 SSH 到远程主机）。',
          '- 需要在该终端里做事时，请直接调用 run_terminal_command，而不是让用户手动复制粘贴命令。',
          '- 危险/不可逆操作调用前请先说明风险；工具调用需要用户确认。',
          ''
        ]
    : []

  let boundary: string[]
  if (hasExecTools) {
    boundary = target.isLocal
      ? [
          '## 执行边界（务必先读）',
          `- 本次会话的目标环境是：**${targetName}**。`,
          '- 你的 run_terminal_command / read_terminal_output 工具会直接作用于下方那个终端窗口（即本机），请优先通过它们操作。',
          '- 你自身另有一个临时工作目录（仅存放本说明），并非用户的真实工作目录；涉及真实路径时用绝对路径，或先在终端里确认当前位置。',
          ''
        ]
      : [
          '## 执行边界（最重要，务必先读）',
          `- 本次会话的目标环境是：**${targetName}**。`,
          '- 下方那个终端窗口已通过 SSH 连到该远程主机；你的 run_terminal_command / read_terminal_output 工具正是作用于这个窗口。',
          '- 要在远程主机上做任何事，请直接调用 run_terminal_command，而不是把命令写成代码块让用户手动执行。',
          '- 切勿用你自身的本地文件工具去「冒充」对远程主机的操作——那会作用在错误的机器（本机）上。',
          ''
        ]
  } else {
    boundary = target.isLocal
      ? [
          '## 执行边界（务必先读）',
          `- 本次会话的目标环境是：**${targetName}**，与你的工具所在机器一致。`,
          '- 你自身的工具（读写文件、执行命令等）运行在本机，可直接用于操作目标。',
          '- 但你的默认工作目录是一个临时目录（仅存放本说明），并非用户的真实工作目录。涉及用户的真实路径时，请使用绝对路径，或先确认当前所在目录。',
          '- 你也可以把命令写成代码块，让用户在下方终端窗口执行——两种方式都作用于同一台本机。',
          ''
        ]
      : [
          '## 执行边界（最重要，务必先读）',
          `- 本次会话的目标环境是：**${targetName}**。`,
          '- 你自身的工具只运行在**本机**，**无法直接访问该远程主机**。下方终端窗口才是连到远程主机的通道。',
          '- 要在远程主机上做任何事，请**把命令写成代码块，让用户在下方终端窗口执行**，再根据回贴的输出继续。',
          '- **切勿**用本地工具去读写本机文件系统来「冒充」对远程主机的操作。',
          '- 不确定某信息属于本机还是远程主机时，先让用户在终端窗口执行命令确认，不要臆测。',
          ''
        ]
  }

  const shared = [
    '# 终端 AI 助手',
    '',
    '你是嵌入在命令行工具中的 AI 助手，通过复用 AI coding 能力为用户提供帮助。',
    '你能看到用户在 shell / 数据库命令行中的上下文，据此理解环境并给出建议或代为执行。',
    '',
    ...boundary,
    '## 核心原则',
    '1. **安全第一**：破坏性、不可逆或高风险的操作执行前必须先说明风险并取得用户确认；能提供回滚/备份方案时一并给出。',
    '2. **专业可靠**：基于实际观察到的环境和输出作答，不臆测。不确定时先查证，再动手。',
    '3. **高效克制**：只做用户需要的事。优先给结论和可执行命令，必要时再解释原因。',
    '4. **最小权限**：不建议无谓的提权或放宽权限；涉及密钥、令牌等敏感信息时提醒用户注意。',
    '',
    '## 工作方式',
    '- 复杂任务分步进行，每步验证结果后再继续。',
    '- 命令 / 语句用代码块展示，保持简洁。',
    '- 使用与用户相同的语言回复。',
    ''
  ]

  const scene =
    kind === 'db'
      ? [
          '## 数据库场景',
          hasExecTools
            ? '- 需要执行 SQL 时直接调用 run_sql_query / run_sql_write，依据返回结果继续。'
            : '- 你无法直接连接该数据库；请把要执行的 SQL 写成代码块，让用户在下方 SQL 执行器中运行，再依据返回结果继续。',
          '- 不预设数据库类型，先从上下文判断实际引擎与方言。',
          '- 编写查询前，若结构不明确，先确认表 / 集合与字段结构。',
          '- 写操作前先用只读方式确认影响范围；大批量变更建议分批执行。',
          ''
        ]
      : [
          '## Shell 场景',
          '- 根据实际命令输出判断操作系统与可用工具，不预设。',
          '- 配置或删除文件前建议先备份；执行前确认路径与作用范围。',
          '- 需要了解当前状态时，先查看已有的终端输出，避免重复或盲目操作。',
          ''
        ]

  const context = contextSnapshot?.trim()
    ? ['## 会话开始时的命令行上下文（快照，需以实时情况为准）', '', contextSnapshot.trim(), '']
    : []

  return [...shared, ...execTools, ...scene, ...context].join('\n')
}

/** English guidance, same structure as {@link buildGuidanceZh}. */
function buildGuidanceEn({ kind, target, contextSnapshot, hasExecTools }: GuidanceInput): string {
  const targetName = target.isLocal ? 'this machine' : `the remote host "${target.label || target.key}"`

  const execTools = hasExecTools
    ? kind === 'db'
      ? [
          '## You can execute directly',
          "- You have run_sql_query (read-only) and run_sql_write (writes) tools that act on the user's current database connection (possibly a remote server).",
          '- When you need data or must run SQL, call these tools instead of asking the user to run it.',
          '- run_sql_write has side effects: explain the impact first. Tool calls require user confirmation.',
          ''
        ]
      : [
          '## You can execute directly',
          '- You have run_terminal_command and read_terminal_output tools that act on the terminal window below (which may be SSH-connected to a remote host).',
          '- When something must be done in that terminal, call run_terminal_command instead of asking the user to copy-paste commands.',
          '- Explain risks before dangerous / irreversible commands. Tool calls require user confirmation.',
          ''
        ]
    : []

  let boundary: string[]
  if (hasExecTools) {
    boundary = target.isLocal
      ? [
          '## Execution boundary (read first)',
          `- The target environment of this session is **${targetName}**.`,
          '- Your run_terminal_command / read_terminal_output tools act on the terminal window below (this machine); prefer them.',
          "- Your own working directory is a scratch folder holding only these notes, not the user's real working directory. Use absolute paths or check the current directory in the terminal first.",
          ''
        ]
      : [
          '## Execution boundary (most important — read first)',
          `- The target environment of this session is **${targetName}**.`,
          '- The terminal window below is connected to that host over SSH; your run_terminal_command / read_terminal_output tools act on exactly that window.',
          '- To do anything on the remote host, call run_terminal_command rather than writing commands for the user to run.',
          '- Never use your own local file tools to "simulate" work on the remote host — they act on the wrong machine (this one).',
          ''
        ]
  } else {
    boundary = target.isLocal
      ? [
          '## Execution boundary (read first)',
          `- The target environment of this session is **${targetName}**, the same machine your tools run on.`,
          '- Your own tools (files, commands) run locally and can operate on the target directly.',
          "- Your default working directory is a scratch folder holding only these notes, not the user's real working directory. Use absolute paths or confirm the current directory first.",
          '- You may also write commands as code blocks for the user to run in the terminal below — both act on the same machine.',
          ''
        ]
      : [
          '## Execution boundary (most important — read first)',
          `- The target environment of this session is **${targetName}**.`,
          '- Your own tools run on **this local machine only** and **cannot reach the remote host**. The terminal window below is the channel to it.',
          '- To do anything on the remote host, **write the command as a code block for the user to run in the terminal below**, then continue from the output they paste back.',
          '- **Never** read or write the local file system to "simulate" work on the remote host.',
          '- If unsure whether something belongs to this machine or the remote host, ask the user to check in the terminal instead of guessing.',
          ''
        ]
  }

  const shared = [
    '# Terminal AI Assistant',
    '',
    'You are an AI assistant embedded in a command-line tool, reusing AI coding capabilities to help the user.',
    'You can see the context of the user\'s shell / database session; use it to understand the environment, then advise or act.',
    '',
    ...boundary,
    '## Core principles',
    '1. **Safety first**: explain the risk of destructive, irreversible or high-impact operations and get confirmation first; offer a rollback / backup plan when possible.',
    '2. **Grounded**: answer from what you actually observe; verify before acting when unsure.',
    '3. **Focused**: do only what the user needs; lead with the conclusion and runnable commands.',
    '4. **Least privilege**: avoid needless privilege escalation; warn about exposing secrets or tokens.',
    '',
    '## Way of working',
    '- Split complex tasks into steps and verify each before continuing.',
    '- Show commands / statements in concise code blocks.',
    '- Reply in the same language as the user.',
    ''
  ]

  const scene =
    kind === 'db'
      ? [
          '## Database',
          hasExecTools
            ? '- Run SQL directly with run_sql_query / run_sql_write and continue from the results.'
            : '- You cannot connect to this database; write the SQL as a code block for the user to run in the SQL executor below, then continue from the results.',
          '- Do not assume the engine; infer the actual engine and dialect from context.',
          '- If the schema is unclear, confirm tables / collections and fields before writing queries.',
          '- Confirm the scope of writes with read-only queries first; batch large changes.',
          ''
        ]
      : [
          '## Shell',
          '- Infer the OS and available tools from real command output; do not assume.',
          '- Back up before changing or deleting files; confirm paths and scope before running.',
          '- Check the existing terminal output before acting to avoid repeated or blind operations.',
          ''
        ]

  const context = contextSnapshot?.trim()
    ? ['## Command-line context at session start (snapshot — verify against the live state)', '', contextSnapshot.trim(), '']
    : []

  return [...shared, ...execTools, ...scene, ...context].join('\n')
}

export interface TerminalAssistantSession {
  sessionId: string
  workspaceId: string
  workingDir: string
}

/** Stable, filesystem-safe working directory for a target machine. */
function workingDirForTarget(target: TerminalAssistantTarget): string {
  const hash = crypto.createHash('sha1').update(target.key).digest('hex').slice(0, 12)
  const rawPrefix = target.isLocal ? 'local' : target.label || target.key || 'host'
  const safePrefix = rawPrefix.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 24) || 'host'
  return path.join(assistantRootDir(), `${safePrefix}-${hash}`)
}

function workspaceTitleForTarget(target: TerminalAssistantTarget, en: boolean): string {
  if (target.isLocal) return en ? 'Local (AI Terminal)' : '本机 (AI Terminal)'
  return `${target.label || target.key} (AI Terminal)`
}

/**
 * Create an assistant session bound to a target machine. Sessions for the same
 * machine reuse one workspace under the "AI Terminal" group; only a fresh
 * runtime coding session is created each time, and the guidance is rewritten
 * with the latest context snapshot and execution boundary.
 *
 * `execTarget` (Claude only) points the in-process MCP tools at the live
 * terminal PTY / DB connection.
 */
export function createTerminalAssistantSession(
  toolType: AIToolType,
  kind: TerminalAssistantKind,
  target: TerminalAssistantTarget,
  contextSnapshot?: string,
  execTarget?: TerminalExecTarget
): TerminalAssistantSession {
  if (EXCLUDED_TOOLS.has(toolType)) {
    throw new Error(`Unsupported terminal assistant tool: ${toolType}`)
  }
  if (!target || !target.key) {
    throw new Error('Terminal assistant target is required')
  }

  const workingDir = workingDirForTarget(target)
  fs.mkdirSync(workingDir, { recursive: true })

  // Claude reads CLAUDE.md, Codex reads AGENTS.md; other tools get them merged
  // by the coding adapters. Only Claude gets exec tools, so the guidance must
  // not promise tools a PTY-based CLI can't call.
  const hasExecTools = toolType === 'claude' && !!execTarget
  const en = isEnglish()
  const input: GuidanceInput = { kind, target, contextSnapshot, hasExecTools }
  const guidance = en ? buildGuidanceEn(input) : buildGuidanceZh(input)
  fs.writeFileSync(path.join(workingDir, 'CLAUDE.md'), guidance, 'utf8')
  fs.writeFileSync(path.join(workingDir, 'AGENTS.md'), guidance, 'utf8')

  const group = ensureGroupByName(ASSISTANT_GROUP_NAME)
  const workspace = ensureWorkspaceForWorkingDirInGroup(workingDir, group.id, workspaceTitleForTarget(target, en))
  const title = kind === 'db' ? (en ? 'DB Assistant' : 'DB 助手') : en ? 'Shell Assistant' : 'Shell 助手'
  const session: AICodingSession = createRuntimeSession(workspace.id, toolType, {
    title,
    ...(hasExecTools && execTarget ? { execTarget } : {})
  })

  logger.info(
    `[TerminalAssistant] Session created: ${session.id} tool=${toolType} kind=${kind} ` +
      `target=${target.key} local=${!!target.isLocal} execTools=${hasExecTools} ` +
      `workspace=${workspace.id} dir=${workingDir}`
  )
  return { sessionId: session.id, workspaceId: workspace.id, workingDir }
}

/**
 * Stop and remove an assistant session. The per-machine working directory is
 * kept: it is shared by every session for that host. Never throws.
 */
export function disposeTerminalAssistantSession(sessionId: string): void {
  try {
    deleteSession(sessionId)
  } catch (err) {
    logger.warn(`[TerminalAssistant] deleteSession failed for ${sessionId}: ${String(err)}`)
  }
}

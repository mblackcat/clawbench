/**
 * Feishu Interactive Card builder.
 *
 * Generates the JSON structure required by the Feishu Open API
 * `im.v1.message.create` / `im.v1.message.patch` endpoints.
 *
 * Card spec: https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/message-card
 */

import type {
  AIWorkbenchWorkspace,
  AIWorkbenchSession
} from '../../store/ai-workbench.store'
import type { IMCardPayload, IMCardSection, IMChatState, InputHistoryEntry } from './types'
import type { SubAppInfo } from '../subapp.service'
import type { MarketApp } from './marketplace.service'
import type { Workspace } from '../../store/workspace.store'

// ── Tool display helpers ──

export const TOOL_LABELS: Record<string, string> = {
  claude: 'Claude Code',
  codex: 'Codex CLI',
  gemini: 'Gemini CLI'
}

const STATUS_LABELS: Record<string, string> = {
  closed: '🔒 未启动',
  running: '🔄 运行中',
  idle: '💤 休息中',
  completed: '✅ 已完成',
  error: '❌ 出错'
}

const ACTIVITY_LABELS: Record<string, string> = {
  thinking: '🧠 思考中',
  writing: '✍️ 写入中',
  reading: '📖 读取中',
  tool_call: '🔧 调用工具',
  waiting_input: '⏳ 等待输入',
  auth_request: '🔐 请求授权',
  none: ''
}

// ── Card builders ──

/**
 * /help — three-group command reference + workspace summaries.
 * Uses schema 2.0 with colored column_set sections and table components.
 */
export function buildHelpCard(
  aiWorkspaces: AIWorkbenchWorkspace[],
  sessions: AIWorkbenchSession[],
  mainWorkspaces: Workspace[]
): IMCardPayload {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const elements: any[] = []

  // ── Section 1: 应用 远程遥控 (violet-50) ──
  elements.push({
    tag: 'column_set',
    flex_mode: 'stretch',
    horizontal_spacing: '12px',
    horizontal_align: 'left',
    columns: [{
      tag: 'column',
      width: 'weighted',
      weight: 1,
      background_style: 'blue-50',
      padding: '12px 12px 12px 12px',
      vertical_spacing: '4px',
      horizontal_align: 'left',
      vertical_align: 'top',
      elements: [
        {
          tag: 'markdown',
          content: "**<font color='violet'>🔧 应用 远程遥控</font>**",
          text_align: 'left',
          text_size: 'normal_v2'
        },
        {
          tag: 'markdown',
          content: '命令按照代码格式：\n`/help` `/h` — 显示本帮助\n`/cw` — 查看 ClawBench 工作区列表\n`/cw <名称或序号>` — 切换工作区\n`/app` `/a` — 列出已安装应用\n`/a <n>` — 运行第 n 个应用\n`/app market` — 查看市场最新应用\n`/app market <关键词>` — 搜索市场应用\n`/app install <应用ID>` — 安装应用',
          text_align: 'left',
          text_size: 'normal_v2'
        }
      ]
    }],
    margin: '0px 0px 0px 0px'
  })

  // ClawBench workspace list (markdown)
  const mainListContent = mainWorkspaces.length === 0
    ? '_暂无工作区_'
    : mainWorkspaces.map((w, i) => `**${i + 1}.** ${w.name}  \`${w.path}\``).join('\n')

  elements.push({
    tag: 'markdown',
    content: mainListContent,
    text_align: 'left',
    text_size: 'normal_v2'
  })

  elements.push({ tag: 'hr', margin: '0px 0px 0px 0px' })

  // ── Section 2: AI Coding (blue-50) ──
  elements.push({
    tag: 'column_set',
    flex_mode: 'stretch',
    horizontal_spacing: '12px',
    horizontal_align: 'left',
    columns: [{
      tag: 'column',
      width: 'weighted',
      weight: 1,
      background_style: 'blue-50',
      padding: '12px 12px 12px 12px',
      vertical_spacing: '4px',
      horizontal_align: 'left',
      vertical_align: 'top',
      elements: [
        {
          tag: 'markdown',
          content: "**<font color='blue'>🤖 AI Coding 远程</font>**",
          text_align: 'left',
          text_size: 'normal_v2'
        },
        {
          tag: 'markdown',
          content: '命令按照代码格式：\n`/work` `/w` — 查看 AI 工作区列表\n`/work <n>` `/w <n>` — 选择第 n 个工作区\n`/session` `/ss` — 查看当前工作区会话列表\n`/ss <n>` — 切换到第 n 个会话\n`/new <工具名>` — 创建新会话（claude/codex/gemini）\n`/exit` — 退出当前活跃会话\n`/status` `/st` — 查看整体状态汇总\n\n_选定工作区/会话后，直接发送文本将转发到终端_',
          text_align: 'left',
          text_size: 'normal_v2'
        }
      ]
    }],
    margin: '0px 0px 0px 0px'
  })

  // AI workspace list (markdown)
  const aiListContent = aiWorkspaces.length === 0
    ? '_暂无工作区_'
    : aiWorkspaces.map((w, i) => {
        const wSessions = sessions.filter(s => s.workspaceId === w.id)
        const tools = [...new Set(wSessions.map(s => TOOL_LABELS[s.toolType] || s.toolType))]
        const toolStr = tools.length > 0 ? tools.join(', ') : '无会话'
        return `**${i + 1}.** ${w.title} (${toolStr})  \`${w.workingDir}\``
      }).join('\n')

  elements.push({
    tag: 'markdown',
    content: aiListContent,
    text_align: 'left',
    text_size: 'normal_v2'
  })

  elements.push({ tag: 'hr', margin: '0px 0px 0px 0px' })

  // ── Section 3: AI Chat (purple-50) ──
  elements.push({
    tag: 'column_set',
    flex_mode: 'stretch',
    horizontal_spacing: '12px',
    horizontal_align: 'left',
    columns: [{
      tag: 'column',
      width: 'weighted',
      weight: 1,
      background_style: 'blue-50',
      padding: '12px 12px 12px 12px',
      vertical_spacing: '4px',
      horizontal_align: 'left',
      vertical_align: 'top',
      elements: [{
        tag: 'markdown',
        content: "**<font color='purple'>💬 AI Chat</font>**\n`/chat <内容>` — 直接发起 AI 对话",
        text_align: 'left',
        text_size: 'normal_v2'
      }]
    }],
    margin: '0px 0px 0px 0px'
  })

  const cardJSON = {
    schema: '2.0',
    config: {
      update_multi: true,
      style: {
        text_size: {
          normal_v2: { default: 'normal', pc: 'normal', mobile: 'heading' }
        }
      }
    },
    header: {
      title: { tag: 'plain_text', content: 'ClawBench 命令说明手册' },
      subtitle: { tag: 'plain_text', content: '' },
      template: 'blue',
      padding: '12px 8px 12px 8px'
    },
    body: {
      direction: 'vertical',
      elements
    }
  }

  return {
    title: 'ClawBench 命令说明手册',
    sections: [],
    rawJSON: JSON.stringify(cardJSON)
  }
}

/**
 * Truncate a filesystem path to fit in a narrow column.
 * Shows the last 2 path components prefixed with "…/" when too long.
 */
function truncatePath(p: string, maxLen = 28): string {
  if (p.length <= maxLen) return p
  const parts = p.replace(/\\/g, '/').split('/').filter(Boolean)
  if (parts.length >= 2) {
    const tail = parts.slice(-2).join('/')
    if (tail.length <= maxLen - 2) return '…/' + tail
  }
  return '…' + p.slice(-(maxLen - 1))
}

// Column weights (integers): #=1, 状态+标识符=3, 类型=2, 路径=4, 操作=2
const COL_W = [1, 3, 2, 4, 2]

/**
 * /work — workspace list as a 5-column table with header row and per-row switch buttons.
 * Columns: 序号 | 状态+标识符 | 类型 | 路径 | 操作
 */
export function buildWorkspaceListCard(
  workspaces: AIWorkbenchWorkspace[],
  sessions: AIWorkbenchSession[]
): IMCardPayload {
  if (workspaces.length === 0) {
    return {
      title: '📋 ClawBench — Coding 工作区列表',
      sections: [{ content: '_暂无工作区，请在桌面端创建_' }]
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const elements: any[] = []

  // ── Header row ──
  const HEADERS = ['**#**', '**工作区**', '**类型**', '**路径**', '**操作**']
  elements.push({
    tag: 'column_set',
    flex_mode: 'none',
    horizontal_spacing: 'small',
    columns: HEADERS.map((h, ci) => ({
      tag: 'column',
      width: 'weighted',
      weight: COL_W[ci],
      vertical_align: 'center',
      elements: [{ tag: 'markdown', content: h }]
    }))
  })
  elements.push({ tag: 'hr' })

  // ── Data rows ──
  for (let i = 0; i < workspaces.length; i++) {
    const w = workspaces[i]
    const wSessions = sessions.filter((s) => s.workspaceId === w.id)
    const runningCount = wSessions.filter(
      (s) => s.status === 'running' || s.status === 'idle'
    ).length
    const statusIcon = runningCount > 0 ? '🟢' : '⚪'
    const toolTypes = [...new Set(wSessions.map(s => TOOL_LABELS[s.toolType] || s.toolType))]
    const toolLabel = toolTypes.length > 0 ? toolTypes.join(', ') : '无会话'
    const pathDisplay = truncatePath(w.workingDir)

    elements.push({
      tag: 'column_set',
      flex_mode: 'none',
      horizontal_spacing: 'small',
      columns: [
        {
          tag: 'column', width: 'weighted', weight: COL_W[0], vertical_align: 'center',
          elements: [{ tag: 'markdown', content: `${i + 1}` }]
        },
        {
          tag: 'column', width: 'weighted', weight: COL_W[1], vertical_align: 'center',
          elements: [{ tag: 'markdown', content: `${statusIcon} **${w.title}**` }]
        },
        {
          tag: 'column', width: 'weighted', weight: COL_W[2], vertical_align: 'center',
          elements: [{ tag: 'markdown', content: toolLabel }]
        },
        {
          tag: 'column', width: 'weighted', weight: COL_W[3], vertical_align: 'center',
          elements: [{ tag: 'markdown', content: pathDisplay }]
        },
        {
          tag: 'column', width: 'weighted', weight: COL_W[4], vertical_align: 'center',
          elements: [{
            tag: 'button',
            text: { tag: 'plain_text', content: '切换' },
            type: 'primary',
            value: { action: 'switch_workspace', value: String(i + 1) }
          }]
        }
      ]
    })

    if (i < workspaces.length - 1) {
      elements.push({ tag: 'hr' })
    }
  }

  const rawJSON = JSON.stringify({
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: '📋 ClawBench — Coding 工作区列表' },
      template: 'blue'
    },
    elements
  })

  return {
    title: '📋 ClawBench — Coding 工作区列表',
    sections: [],
    rawJSON
  }
}

/**
 * /work <n> — workspace detail with session list.
 */
export function buildWorkspaceDetailCard(
  workspace: AIWorkbenchWorkspace,
  sessions: AIWorkbenchSession[]
): IMCardPayload {
  const toolTypes = [...new Set(sessions.map(s => TOOL_LABELS[s.toolType] || s.toolType))]
  const toolLabel = toolTypes.length > 0 ? toolTypes.join(', ') : '无会话'

  const sessionLines = sessions.length === 0
    ? '_暂无会话_'
    : sessions.map((s, i) => {
        const status = STATUS_LABELS[s.status] || s.status
        const activity = ACTIVITY_LABELS[s.lastActivity] || ''
        const sToolLabel = TOOL_LABELS[s.toolType] || s.toolType
        const resumeTag = s.toolSessionId ? ` 🔄` : ''
        return `**${i + 1}.** [${sToolLabel}] ${status}${activity ? '  ' + activity : ''}${resumeTag}`
      }).join('\n')

  const actions: IMCardPayload['actions'] = []
  if (sessions.length > 0) {
    const activeSession = sessions.find((s) => s.status === 'running' || s.status === 'idle')
    if (activeSession) {
      actions.push({ tag: 'stop_session', label: '⏹ 退出活跃会话', value: activeSession.id, type: 'danger' })
    }
  }

  return {
    title: `🗂 ${toolLabel} — ${workspace.title}`,
    sections: [
      {
        title: '工作区信息',
        content: `📁 ${workspace.workingDir}`
      },
      {
        title: `会话 (${sessions.length})`,
        content: sessionLines
      }
    ],
    actions
  }
}

// ── Output formatting helpers ──

/**
 * Strip ANSI escape codes from a string.
 */
function stripAnsi(str: string): string {
  // CSI sequences: ESC [ ... m/A/B/...
  // Single-char escapes: ESC c, ESC M, etc.
  return str
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
    .replace(/\x1b[()][0-9A-Za-z]/g, '')
    .replace(/\x1b[A-Za-z]/g, '')
}

/**
 * Parse raw terminal output into a compact display string.
 *
 * - If there are 2+ task-list lines → render as emoji checkboxes (last 15)
 * - Otherwise → return the last non-empty block (text after last blank line),
 *   capped at 12 lines; falls back to last 8 lines if no blank separators
 */
function parseOutputForDisplay(rawOutput: string): string {
  if (!rawOutput) return ''

  const cleaned = stripAnsi(rawOutput)
  const lines = cleaned
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.trim())

  if (lines.length === 0) return ''

  // Detect task-list lines: optional bullet, checkbox [x] or [ ], then text
  const taskRe = /^\s*[-*]?\s*\[[ xX✓✔]\]\s+.+/
  const taskLines = lines.filter((l) => taskRe.test(l))

  if (taskLines.length >= 2) {
    return taskLines
      .slice(-15)
      .map((l) => {
        const done = /\[[xX✓✔]\]/.test(l)
        const text = l.replace(/^\s*[-*]?\s*\[[ xX✓✔]\]\s*/, '').trim()
        return done ? `✅ ${text}` : `⬜ ${text}`
      })
      .join('\n')
  }

  // Extract last non-empty block (separated by blank lines)
  const blocks = cleaned.split(/\n\s*\n/).filter(b => b.trim())
  if (blocks.length > 1) {
    const lastBlock = blocks[blocks.length - 1]
    const blockLines = lastBlock.split('\n').map(l => l.trimEnd()).filter(l => l.trim())
    if (blockLines.length > 0) {
      return blockLines.slice(-12).join('\n')
    }
  }

  // Fall back to last 8 non-empty lines
  return lines.slice(-8).join('\n')
}

/**
 * Session detail card (for auto-refresh of active session).
 */
export function buildSessionDetailCard(
  workspace: AIWorkbenchWorkspace,
  session: AIWorkbenchSession,
  processOutput: string
): IMCardPayload {
  const toolLabel = TOOL_LABELS[session.toolType] || session.toolType
  const statusLabel = STATUS_LABELS[session.status] || session.status
  const activity = session.lastActivity

  // Determine interactive state label
  let interactiveLabel = ''
  if (activity === 'waiting_input') interactiveLabel = '💬 等待您回复'
  else if (activity === 'auth_request') interactiveLabel = '🔐 请求授权确认'
  else if (ACTIVITY_LABELS[activity]) interactiveLabel = ACTIVITY_LABELS[activity]

  const statusLine = `${statusLabel}${interactiveLabel ? '  ' + interactiveLabel : ''}`

  const displayOutput = parseOutputForDisplay(processOutput)

  const actions: IMCardPayload['actions'] = []

  // Interactive quick-reply buttons
  if (activity === 'waiting_input') {
    actions.push({
      tag: 'send_to_session',
      label: '✅ 确认 (y)',
      value: `${session.id}:y`,
      type: 'primary'
    })
    actions.push({
      tag: 'send_to_session',
      label: '❌ 取消 (n)',
      value: `${session.id}:n`,
      type: 'danger'
    })
  } else if (activity === 'auth_request') {
    actions.push({
      tag: 'send_to_session',
      label: '✅ 允许',
      value: `${session.id}:y`,
      type: 'primary'
    })
    actions.push({
      tag: 'send_to_session',
      label: '❌ 拒绝',
      value: `${session.id}:n`,
      type: 'danger'
    })
  }

  // Lifecycle buttons
  if (session.status === 'running' || session.status === 'idle') {
    actions.push({ tag: 'stop_session', label: '⏹ 退出', value: session.id, type: 'default' })
  }
  if (session.status === 'closed' || session.status === 'completed' || session.status === 'error') {
    actions.push({ tag: 'launch_session', label: '▶ 启动', value: session.id, type: 'primary' })
  }

  const duration = session.durationMs
    ? `${Math.floor(session.durationMs / 60000)}m ${Math.floor((session.durationMs % 60000) / 1000)}s`
    : session.startedAt
      ? `${Math.floor((Date.now() - session.startedAt) / 60000)}m`
      : ''
  const cost = session.costUsd !== undefined ? `$${session.costUsd.toFixed(2)}` : ''
  const footerItems: string[] = []
  if (duration) footerItems.push(`⏱ ${duration}`)
  if (cost) footerItems.push(`💰 ${cost}`)
  if (session.toolSessionId) footerItems.push(`🔗 ${session.toolSessionId}`)

  const sections: IMCardSection[] = [
    {
      title: '状态',
      content: `${statusLine}\n📁 ${workspace.workingDir}`
    },
    {
      title: '进程输出',
      content: displayOutput || '_（暂无输出）_'
    }
  ]
  if (footerItems.length > 0) {
    sections.push({ content: footerItems.join('  |  ') })
  }

  return {
    title: `${toolLabel} — ${workspace.title}`,
    sections,
    actions
  }
}

/**
 * Proactive completion card sent when a session transitions to completed/error.
 */
export function buildCompletionCard(
  workspace: AIWorkbenchWorkspace,
  session: AIWorkbenchSession,
  processOutput: string
): IMCardPayload {
  const toolLabel = TOOL_LABELS[session.toolType] || session.toolType
  const isError = session.status === 'error'
  const title = isError
    ? `❌ ${toolLabel} — ${workspace.title}（出错）`
    : `✅ ${toolLabel} — ${workspace.title}（已完成）`

  const displayOutput = parseOutputForDisplay(processOutput)

  return {
    title,
    sections: [
      {
        title: '输出摘要',
        content: displayOutput || '_（暂无输出）_'
      },
      {
        content: `📁 ${workspace.workingDir}`
      }
    ],
    actions: [
      { tag: 'launch_session', label: '▶ 重新启动', value: session.id, type: 'primary' }
    ]
  }
}

/**
 * /status — aggregate status overview with per-chat context.
 */
export function buildStatusCard(
  workspaces: AIWorkbenchWorkspace[],
  sessions: AIWorkbenchSession[],
  chatState: IMChatState | undefined
): IMCardPayload {
  const counts = {
    closed: 0,
    running: 0,
    completed: 0,
    idle: 0,
    error: 0
  }
  for (const s of sessions) {
    if (s.status in counts) counts[s.status as keyof typeof counts]++
  }

  const contextLine = chatState?.activeWorkspaceId
    ? (() => {
        const ws = workspaces.find((w) => w.id === chatState.activeWorkspaceId)
        if (!ws) return '当前工作区: _未设置_'
        const wsSessions = sessions.filter(s => s.workspaceId === ws.id)
        const wsTools = [...new Set(wsSessions.map(s => TOOL_LABELS[s.toolType] || s.toolType))]
        return `当前工作区: **${ws.title}** (\`${wsTools.join(', ') || '暂无会话'}\`)`
      })()
    : '当前工作区: _未设置_'

  return {
    title: '📊 AI 工作台 — 状态总览',
    sections: [
      {
        content: [
          contextLine,
          '',
          `🔄 运行中: **${counts.running}**`,
          `✅ 已完成: **${counts.completed}**`,
          `💤 休息中: **${counts.idle}**`,
          `❌ 出错: **${counts.error}**`,
          `🔒 未启动: **${counts.closed}**`,
          '',
          `共计 **${workspaces.length}** 个工作区，**${sessions.length}** 个会话`
        ].join('\n')
      }
    ]
  }
}

/**
 * Prompt card: no workspace selected yet.
 */
export function buildNoContextCard(): IMCardPayload {
  return {
    title: '💡 提示',
    sections: [
      {
        content: '请先用 `/w <n>` 选择工作区，然后即可发送文本到终端。\n\n输入 `/help` 查看所有可用指令。'
      }
    ]
  }
}

// ── App management card builders ──

/**
 * /app — list installed sub-apps as a table.
 */
export function buildAppListCard(apps: SubAppInfo[]): IMCardPayload {
  if (apps.length === 0) {
    return {
      title: '📦 已安装应用',
      sections: [{ content: '_暂无已安装应用_\n\n使用 `/app market` 浏览应用市场。' }]
    }
  }

  const COL_W = [1, 3, 5, 3]
  const HEADERS = ['**#**', '**名称**', '**描述**', '**参数**']

  const elements: any[] = []

  elements.push({
    tag: 'column_set',
    flex_mode: 'none',
    horizontal_spacing: 'small',
    columns: HEADERS.map((h, ci) => ({
      tag: 'column',
      width: 'weighted',
      weight: COL_W[ci],
      vertical_align: 'center',
      padding: '4px 0px 4px 0px',
      elements: [{ tag: 'markdown', content: h }]
    }))
  })
  elements.push({ tag: 'hr' })

  for (let i = 0; i < apps.length; i++) {
    const app = apps[i]
    const params = app.manifest.params as Array<{ name: string; required?: boolean }> | undefined
    const requiredParams = params?.filter((p) => p.required !== false).map((p) => p.name) ?? []
    const paramStr = requiredParams.length > 0 ? requiredParams.join(', ') : '无'

    elements.push({
      tag: 'column_set',
      flex_mode: 'none',
      horizontal_spacing: 'small',
      columns: [
        {
          tag: 'column', width: 'weighted', weight: COL_W[0], vertical_align: 'center',
          padding: '4px 0px 4px 0px',
          elements: [{ tag: 'markdown', content: `${i + 1}` }]
        },
        {
          tag: 'column', width: 'weighted', weight: COL_W[1], vertical_align: 'center',
          padding: '4px 0px 4px 0px',
          elements: [{ tag: 'markdown', content: `**${app.manifest.name}**` }]
        },
        {
          tag: 'column', width: 'weighted', weight: COL_W[2], vertical_align: 'center',
          padding: '4px 0px 4px 0px',
          elements: [{ tag: 'markdown', content: app.manifest.description || '_无描述_' }]
        },
        {
          tag: 'column', width: 'weighted', weight: COL_W[3], vertical_align: 'center',
          padding: '4px 0px 4px 0px',
          elements: [{ tag: 'markdown', content: `\`${paramStr}\`` }]
        }
      ]
    })
  }

  elements.push({ tag: 'hr' })
  elements.push({
    tag: 'markdown',
    content: '_发送 `/a <序号>` 运行应用，有参数时用 `/a <序号> <参数值>...` 传入_'
  })

  const cardJSON = {
    config: { wide_screen_mode: true },
    header: { title: { tag: 'plain_text', content: `📦 已安装应用 (${apps.length})` }, template: 'blue' },
    elements
  }

  return { title: `📦 已安装应用 (${apps.length})`, sections: [], rawJSON: JSON.stringify(cardJSON) }
}

/**
 * /app market — display marketplace apps.
 */
export function buildAppMarketCard(apps: MarketApp[], keywords?: string): IMCardPayload {
  const headerTitle = keywords ? `🛒 应用市场 — "${keywords}"` : '🛒 应用市场 — 最新可安装'

  if (apps.length === 0) {
    return {
      title: headerTitle,
      sections: [{ content: keywords ? `_没有找到与"${keywords}"相关的应用_` : '_暂无可安装应用_' }]
    }
  }

  const lines = apps.map((app, i) => {
    const updateTag = app.hasLocalUpdate ? ' `[有更新]`' : ''
    const version = app.version ? ` v${app.version}` : ''
    return [
      `**${i + 1}. ${app.name}**${version}${updateTag}`,
      `> ${app.description || '暂无描述'}`,
      `ID: \`${app.applicationId}\``
    ].join('\n')
  })

  return {
    title: headerTitle,
    sections: [
      { content: lines.join('\n\n') },
      { content: '_发送 `/app install <应用ID>` 安装_' }
    ]
  }
}

/**
 * Running card for an IM-triggered app task.
 */
export function buildAppRunningCard(appName: string): IMCardPayload {
  return {
    title: `⏳ 运行中 — ${appName}`,
    sections: [{ content: '_应用正在执行，请稍候…_' }]
  }
}

/**
 * Result card for a completed IM-triggered app task.
 */
export function buildAppResultCard(
  appName: string,
  success: boolean,
  summary: string,
  outputLines: string
): IMCardPayload {
  const icon = success ? '✅' : '❌'
  const statusText = success ? '执行完成' : '执行失败'
  const content = [
    `**${icon} ${statusText}**`,
    summary ? `> ${summary}` : '',
    outputLines ? `\`\`\`\n${outputLines}\n\`\`\`` : ''
  ].filter(Boolean).join('\n\n')

  return {
    title: `${icon} ${appName} — ${statusText}`,
    sections: [{ content }]
  }
}



// ── Auth option detection ──

/**
 * Detect numbered options or y/n patterns in buffered terminal output.
 * Returns an array of button labels or null if no auth/choice detected.
 */
export function parseAuthOptions(bufferedOutput: string): string[] | null {
  if (!bufferedOutput) return null

  const lines = bufferedOutput.split('\n').map(l => l.trim()).filter(Boolean)
  const last12 = lines.slice(-12)
  const last12Text = last12.join('\n')

  // Claude Code plan mode — ExitPlanMode tool_use written to buffer as "⚙ [ExitPlanMode]"
  if (/⚙\s*\[ExitPlanMode\]/i.test(last12Text)) {
    return ['确认 (y)', '取消 (n)']
  }

  // Numbered options on separate lines: "1. Allow once\n2. Always allow\n3. Deny"
  const numberedLines = last12.filter(l => /^\d+\.\s+/.test(l))
  if (numberedLines.length >= 2) {
    return numberedLines.map(l => l.trim())
  }

  // Inline numbered options on a single line
  const inlineMatch = last12Text.match(/(\d+)\.\s+(\S[^0-9]*?)(?=\s+\d+\.|$)/g)
  if (inlineMatch && inlineMatch.length >= 2) {
    return inlineMatch.map(m => m.trim())
  }

  // y/n/a patterns
  if (/\(y\/n\/a\)|\[y\/n\/a\]/i.test(last12Text)) {
    return ['确认 (y)', '始终允许 (a)', '拒绝 (n)']
  }
  if (/\(Y\/n\)|\(y\/N\)|\[y\/N\]|\[Y\/n\]|\(y\/n\)|\[y\/n\]|\(yes\/no\)|\[yes\/no\]/i.test(last12Text)) {
    return ['确认 (y)', '取消 (n)']
  }

  return null
}

// ── Response extraction helper ──

/**
 * Extract the actual response text from a button label.
 * - "确认 (y)" -> "y"
 * - "1. Allow once" -> "1"
 * - Plain label -> label itself
 */
function extractResponse(label: string): string {
  const parenMatch = label.match(/\((\w+)\)\s*$/)
  if (parenMatch) return parenMatch[1]
  const numMatch = label.match(/^(\d+)\.\s/)
  if (numMatch) return numMatch[1]
  return label
}

// ── v2.0 Session card ──

/**
 * Build a rich v2.0 session card with real-time output, duration/cost,
 * input form (normal mode), auth buttons (interactive mode), or restart button (done).
 */
export function buildSessionCardV2(
  workspace: AIWorkbenchWorkspace,
  session: AIWorkbenchSession,
  processOutput: string,
  authOptions?: string[] | null,
  sessionNumber?: number,
  inputHistory?: InputHistoryEntry[]
): IMCardPayload {
  const toolLabel = TOOL_LABELS[session.toolType] || session.toolType
  const statusLabel = STATUS_LABELS[session.status] || session.status

  const cost = session.costUsd !== undefined ? `$${session.costUsd.toFixed(2)}` : ''

  const displayOutput = parseOutputForDisplay(processOutput)

  const headerTitle = sessionNumber
    ? `${workspace.title} session #${sessionNumber}`
    : `${workspace.title} session`

  // Activity label
  const activity = session.lastActivity
  let interactiveLabel = ''
  if (activity === 'waiting_input') interactiveLabel = '💬 等待您回复'
  else if (activity === 'auth_request') interactiveLabel = '🔐 请求授权确认'
  else if (ACTIVITY_LABELS[activity]) interactiveLabel = ACTIVITY_LABELS[activity]

  const statusLine = `${statusLabel}${interactiveLabel ? '  ' + interactiveLabel : ''}`

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const elements: any[] = []

  // Status line
  elements.push({
    tag: 'markdown',
    content: statusLine,
    text_align: 'left',
    text_size: 'normal'
  })

  // Output content
  elements.push({
    tag: 'markdown',
    content: displayOutput || '_(暂无输出)_',
    text_align: 'left',
    text_size: 'normal',
    margin: '0px 8px 0px 8px'
  })

  const isInteractive = activity === 'auth_request' || activity === 'waiting_input'
  const isFinished = session.status === 'completed' || session.status === 'error' || session.status === 'closed'
  const isRunning = session.status === 'running' || session.status === 'idle'

  // Resolve effective auth options:
  // - Use detected options if available
  // - For auth_request with no detected options, default to allow-once / always-allow / deny
  // - For waiting_input with no detected options, show input form (null = Mode B)
  const effectiveAuthOptions = authOptions && authOptions.length > 0
    ? authOptions
    : activity === 'auth_request'
      ? ['确认 (y)', '始终允许 (a)', '拒绝 (n)']
      : null

  if (isInteractive && effectiveAuthOptions) {
    // Mode A: Auth/confirmation buttons
    const authColumns = effectiveAuthOptions.map((opt) => ({
      tag: 'column',
      width: 'auto',
      elements: [{
        tag: 'button',
        text: { tag: 'plain_text', content: opt },
        type: opt.includes('取消') || opt.includes('拒绝') ? 'danger' : 'primary',
        value: { action: 'send_to_session', value: `${session.id}:${extractResponse(opt)}` }
      }]
    }))
    elements.push({
      tag: 'column_set',
      flex_mode: 'flow',
      horizontal_spacing: '8px',
      horizontal_align: 'left',
      columns: authColumns
    })
  } else if (isRunning) {
    // Mode B: Input form with send/pause/exit buttons

    // Input history — show above the form so sent messages persist across card refreshes
    if (inputHistory && inputHistory.length > 0) {
      const historyLines = inputHistory.map((entry) => {
        const icon = entry.done ? '✅' : '🔄'
        // Truncate very long inputs to keep the card compact
        const preview = entry.text.length > 80 ? entry.text.slice(0, 77) + '...' : entry.text
        return `${icon} ${preview}`
      })
      elements.push({
        tag: 'markdown',
        content: '─── 已发送记录 ───\n' + historyLines.join('\n───────────\n'),
        text_align: 'left',
        text_size: 'notation',
        margin: '4px 8px 4px 8px'
      })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const actionColumns: any[] = [
      {
        tag: 'column',
        width: 'auto',
        elements: [{
          tag: 'button',
          text: { tag: 'plain_text', content: '↩ 发送' },
          type: 'primary_filled',
          width: 'fill',
          form_action_type: 'submit',
          name: `send_button_${session.id}`,
          margin: '4px 0px 4px 0px',
          value: { action: 'form_input', value: session.id }
        }]
      }
    ]
    if (session.status === 'running') {
      actionColumns.push({
        tag: 'column',
        width: 'auto',
        elements: [{
          tag: 'button',
          text: { tag: 'plain_text', content: '⏸ 暂停' },
          type: 'default',
          width: 'fill',
          margin: '4px 0px 4px 0px',
          value: { action: 'interrupt_session', value: session.id }
        }]
      })
    }
    actionColumns.push({
      tag: 'column',
      width: 'auto',
      elements: [{
        tag: 'button',
        text: { tag: 'plain_text', content: '⏹ 退出' },
        type: 'danger',
        width: 'fill',
        margin: '4px 0px 4px 0px',
        value: { action: 'stop_session', value: session.id }
      }]
    })
    elements.push({
      tag: 'form',
      name: `cli_input_form_${session.id}`,
      direction: 'vertical',
      horizontal_align: 'left',
      vertical_align: 'top',
      padding: '12px 12px 12px 12px',
      margin: '0px 0px 0px 0px',
      elements: [
        {
          tag: 'input',
          name: 'user_input',
          placeholder: { tag: 'plain_text', content: '输入对话，发送后将转发到终端...' },
          default_value: '',
          width: 'fill',
          margin: '0px 0px 0px 0px'
        },
        {
          tag: 'column_set',
          flex_mode: 'flow',
          horizontal_spacing: '8px',
          horizontal_align: 'left',
          columns: actionColumns
        }
      ]
    })
  } else if (isFinished) {
    // Mode C: Restart button
    elements.push({
      tag: 'column_set',
      flex_mode: 'flow',
      horizontal_spacing: '8px',
      horizontal_align: 'left',
      columns: [{
        tag: 'column',
        width: 'auto',
        elements: [{
          tag: 'button',
          text: { tag: 'plain_text', content: '▶ 重新启动' },
          type: 'primary',
          value: { action: 'launch_session', value: session.id }
        }]
      }]
    })
  }

  // Footer: duration/cost (isFinished) + session ID — always on the same notation line
  const finishedDuration = isFinished
    ? (session.durationMs
        ? `${Math.floor(session.durationMs / 60000)}m ${Math.floor((session.durationMs % 60000) / 1000)}s`
        : '0m')
    : null
  const footerLeft = finishedDuration
    ? [`⏱ ${finishedDuration}`, cost ? `💰 ${cost}` : ''].filter(Boolean).join('  |  ')
    : null
  const footerRight = session.toolSessionId
    ? `session id: \`${session.toolSessionId}\``
    : `id: \`${session.id.slice(0, 8)}\``

  if (footerLeft || footerRight) {
    elements.push({
      tag: 'column_set',
      flex_mode: 'none',
      horizontal_spacing: '8px',
      columns: [
        {
          tag: 'column',
          width: 'weighted',
          weight: 1,
          vertical_align: 'center',
          elements: footerLeft ? [{
            tag: 'markdown',
            content: footerLeft,
            text_align: 'left',
            text_size: 'notation'
          }] : []
        },
        {
          tag: 'column',
          width: 'weighted',
          weight: 1,
          vertical_align: 'center',
          elements: footerRight ? [{
            tag: 'markdown',
            content: footerRight,
            text_align: 'right',
            text_size: 'notation'
          }] : []
        }
      ]
    })
  }

  // Build v2.0 card JSON
  const cardJSON = {
    schema: '2.0',
    config: { update_multi: true },
    header: {
      title: { tag: 'plain_text', content: headerTitle },
      subtitle: { tag: 'plain_text', content: 'ClawBench - AI Coding' },
      template: 'blue',
      text_tag_list: [{
        tag: 'text_tag',
        text: { tag: 'plain_text', content: toolLabel },
        color: 'blue'
      }]
    },
    body: {
      direction: 'vertical',
      elements
    }
  }

  return {
    title: headerTitle,
    sections: [],
    rawJSON: JSON.stringify(cardJSON)
  }
}


/**
 * Convert our platform-agnostic `IMCardPayload` into the Feishu interactive
 * card JSON that can be passed to `msg_type: "interactive"`.
 */
export function toFeishuCardJSON(card: IMCardPayload): string {
  // Pre-built JSON (e.g. column_set layouts) bypasses generic rendering
  if (card.rawJSON) return card.rawJSON

  const elements: any[] = []

  for (const section of card.sections) {
    if (section.title) {
      elements.push({
        tag: 'div',
        text: { tag: 'lark_md', content: `**${section.title}**` }
      })
    }
    elements.push({
      tag: 'div',
      text: { tag: 'lark_md', content: section.content }
    })
    // Per-section action buttons (e.g. "切换" for workspace list rows)
    if (section.actions && section.actions.length > 0) {
      elements.push({
        tag: 'action',
        actions: section.actions.map((a) => ({
          tag: 'button',
          text: { tag: 'plain_text', content: a.label },
          type: a.type || 'default',
          value: { action: a.tag, value: a.value || '' }
        }))
      })
    }
    elements.push({ tag: 'hr' })
  }

  // Remove trailing hr
  if (elements.length > 0 && elements[elements.length - 1].tag === 'hr') {
    elements.pop()
  }

  // Actions row
  if (card.actions && card.actions.length > 0) {
    elements.push({
      tag: 'action',
      actions: card.actions.map((a) => ({
        tag: 'button',
        text: { tag: 'plain_text', content: a.label },
        type: a.type || 'default',
        value: { action: a.tag, value: a.value || '' }
      }))
    })
  }

  const cardJSON = {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: card.title },
      template: 'blue'
    },
    elements
  }

  return JSON.stringify(cardJSON)
}

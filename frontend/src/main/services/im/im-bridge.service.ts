/**
 * IM Bridge Service — orchestrator between IM adapters and AI Workbench.
 *
 * Responsibilities:
 * - Manage adapter lifecycle (connect / disconnect)
 * - Route incoming commands to workspace/session operations
 * - Maintain per-chat state (active workspace + session)
 * - Maintain card mappings for auto-refresh
 * - Run a 15-second timer to push process output updates to active cards
 * - Handle interactive card button callbacks
 * - Forward plain text to terminal stdin when a session is active
 * - Notify renderer of connection state changes via IPC push events
 */

import { BrowserWindow } from 'electron'
import type {
  IMAdapter,
  IMConnectionStatus,
  IMIncomingMessage,
  IMCardCallback,
  CardMapping,
  IMChatState,
  InputHistoryEntry
} from './types'
import { parseCommand } from './im-commands'
import {
  buildHelpCard,
  buildWorkspaceListCard,
  buildWorkspaceDetailCard,
  buildCompletionCard,
  buildStatusCard,
  buildNoContextCard,
  buildAppListCard,
  buildAppMarketCard,
  buildAppRunningCard,
  buildAppResultCard,
  buildSessionCardV2,
  parseAuthOptions
} from './feishu-cards'
import { FeishuAdapter } from './feishu-adapter'
import {
  getWorkspaces,
  getSessions,
  getSessionsForWorkspace,
  createSession,
  stopSession,
  interruptSession,
  launchSession,
  writeToSession,
  getSessionOutput,
  getIMConfig
} from '../ai-workbench.service'
import type { AIToolType } from '../../store/ai-workbench.store'
import { listSubApps, getSubAppPath } from '../subapp.service'
import { listWorkspaces, setActiveWorkspace } from '../workspace.service'
import { executeSubAppWithCallbacks } from '../python-runner.service'
import { listRecentMarketApps, searchMarketApps, installMarketApp } from './marketplace.service'
import { settingsStore, getAiModelConfigs, getLastChatModel } from '../../store/settings.store'
import { getPythonSdkPath } from '../../utils/paths'
import { randomUUID } from 'crypto'

// ── Singleton ──

let instance: IMBridgeService | null = null

export function getIMBridgeService(): IMBridgeService {
  if (!instance) {
    instance = new IMBridgeService()
  }
  return instance
}

// ── Bridge Service ──

class IMBridgeService {
  private adapter: IMAdapter | null = null
  private updateTimer: ReturnType<typeof setInterval> | null = null
  private cardMappings: CardMapping[] = []
  private chatStates = new Map<string, IMChatState>()
  /** Pending multi-step refresh timers per session, cancelled on new input */
  private pendingRefreshTimers = new Map<string, ReturnType<typeof setTimeout>[]>()

  /** Which adapter is currently active */
  getAdapterName(): string | null {
    return this.adapter?.name ?? null
  }

  getConnectionStatus(): IMConnectionStatus {
    return (
      this.adapter?.getStatus() ?? {
        state: 'disconnected'
      }
    )
  }

  getCardMappings(): CardMapping[] {
    return [...this.cardMappings]
  }

  // ── Per-chat state helpers ──

  private getChatState(chatId: string): IMChatState {
    let state = this.chatStates.get(chatId)
    if (!state) {
      state = { chatId, activeWorkspaceId: null, activeSessionId: null }
      this.chatStates.set(chatId, state)
    }
    return state
  }

  // ── Connect / Disconnect ──

  async connect(platform: 'feishu'): Promise<void> {
    // Currently only Feishu is supported
    if (platform !== 'feishu') {
      throw new Error(`Unsupported IM platform: ${platform}`)
    }

    const imConfig = getIMConfig()
    const { appId, appSecret } = imConfig.feishu
    if (!appId || !appSecret) {
      throw new Error('请先配置飞书 App ID 和 App Secret')
    }

    // Disconnect existing adapter to avoid duplicate event handlers
    if (this.adapter) {
      await this.adapter.disconnect()
      this.adapter = null
    }

    // Create adapter
    const adapter = new FeishuAdapter()

    // Wire event hooks
    adapter.onMessage = (msg) => this.handleIncomingMessage(msg)
    adapter.onCardCallback = (cb) => this.handleCardCallback(cb)
    adapter.onStatusChange = (status) => this.broadcastStatus(status)

    await adapter.connect({ appId, appSecret })
    this.adapter = adapter

    // Start the 15-second update timer
    this.startUpdateTimer()

    // Broadcast connected status to renderer
    this.broadcastStatus(adapter.getStatus())
  }

  async disconnect(): Promise<void> {
    this.stopUpdateTimer()

    if (this.adapter) {
      await this.adapter.disconnect()
      this.adapter = null
    }

    // Clear all card mappings and chat states
    this.cardMappings = []
    this.chatStates.clear()

    this.broadcastStatus({ state: 'disconnected' })
  }

  async testConnection(): Promise<{ success: boolean; error?: string }> {
    const imConfig = getIMConfig()
    const { appId, appSecret } = imConfig.feishu
    if (!appId || !appSecret) {
      return { success: false, error: '请先配置飞书 App ID 和 App Secret' }
    }

    try {
      const adapter = new FeishuAdapter()
      await adapter.connect({ appId, appSecret })
      // Brief connection test, then disconnect
      await adapter.disconnect()
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) }
    }
  }

  // ── Message handling ──

  private async handleIncomingMessage(msg: IMIncomingMessage): Promise<void> {
    const { chatId, text } = msg
    console.log('[IMBridge] Handling incoming message:', text)
    const parsed = parseCommand(text)
    console.log('[IMBridge] Parsed command:', parsed)

    try {
      switch (parsed.command) {
        case 'help':
          await this.handleHelp(chatId)
          break

        case 'work':
          if (parsed.args.length > 0) {
            await this.handleWorkSwitch(chatId, parsed.args[0])
          } else {
            await this.handleWorkList(chatId)
          }
          break

        case 'session':
          if (parsed.args.length > 0) {
            await this.handleSessionSwitch(chatId, parsed.args[0])
          } else {
            await this.handleSessionList(chatId)
          }
          break

        case 'exit':
          await this.handleExit(chatId)
          break

        case 'status':
          await this.handleStatus(chatId)
          break

        case 'app-list':
          await this.handleAppList(chatId)
          break

        case 'app-run':
          await this.handleAppRun(chatId, parsed.args[0], parsed.args.slice(1))
          break

        case 'app-market':
          await this.handleAppMarket(chatId, parsed.args[0])
          break

        case 'app-install':
          await this.handleAppInstall(chatId, parsed.args[0])
          break

        case 'cw':
          await this.handleCw(chatId, parsed.args[0])
          break

        case 'new':
          await this.handleNew(chatId, parsed.args[0])
          break

        case 'chat':
          await this.handleChat(chatId, parsed.args[0] || '')
          break

        default: {
          // No command prefix — check if we have an active session for stdin forwarding
          const chatState = this.getChatState(chatId)
          if (chatState.activeSessionId) {
            await this.handleStdinForward(chatId, text, msg.messageId)
          } else if (chatState.activeWorkspaceId) {
            await this.adapter?.sendText(chatId, '请先用 /ss <n> 选择会话，或直接发送 /w 查看工作区列表')
          } else {
            // No active context and not a recognized command
            if (text.trim().startsWith('/')) {
              await this.adapter?.sendText(chatId, '未识别的指令，输入 /help 查看可用指令')
            } else {
              const card = buildNoContextCard()
              await this.adapter?.sendCard(chatId, card)
            }
          }
        }
      }
    } catch (err) {
      console.error('[IMBridge] Error handling command:', parsed.command, err)
      try {
        await this.adapter?.sendText(chatId, `处理指令时出错: ${err}`)
      } catch {
        // Silently fail on error reporting
      }
    }
  }

  private async handleHelp(chatId: string): Promise<void> {
    const aiWorkspaces = getWorkspaces()
    const sessions = getSessions()
    const mainWorkspaces = listWorkspaces()
    const card = buildHelpCard(aiWorkspaces, sessions, mainWorkspaces)
    await this.adapter?.sendCard(chatId, card)
  }

  private async handleCw(chatId: string, query?: string): Promise<void> {
    const workspaces = listWorkspaces()

    if (!query) {
      // List mode
      if (workspaces.length === 0) {
        await this.adapter?.sendText(chatId, '暂无工作区，请先在 ClawBench 中添加工作区。')
        return
      }
      const lines = workspaces.map((w, i) => `**${i + 1}.** ${w.name}  \`${w.path}\``).join('\n')
      await this.adapter?.sendText(chatId, `📁 ClawBench 工作区列表：\n\n${lines}\n\n发送 \`/cw <名称或序号>\` 切换。`)
      return
    }

    // Switch mode — match by 1-based index or name substring
    const idx = /^\d+$/.test(query) ? parseInt(query, 10) - 1 : -1
    const target = idx >= 0
      ? workspaces[idx]
      : workspaces.find((w) => w.name.toLowerCase().includes(query.toLowerCase()))

    if (!target) {
      await this.adapter?.sendText(chatId, `❌ 未找到工作区「${query}」，发送 \`/cw\` 查看列表。`)
      return
    }

    const result = setActiveWorkspace(target.id)
    if (result.success) {
      await this.adapter?.sendText(chatId, `✅ 已切换到工作区：**${target.name}**\n\`${target.path}\``)
    } else {
      await this.adapter?.sendText(chatId, `❌ 切换失败：${result.error}`)
    }
  }

  private async handleNew(chatId: string, toolArg?: string): Promise<void> {
    const chatState = this.getChatState(chatId)
    if (!chatState.activeWorkspaceId) {
      await this.adapter?.sendText(chatId, '请先用 /w <n> 选择工作区')
      return
    }

    const validTools = ['claude', 'codex', 'gemini']

    if (!toolArg) {
      await this.adapter?.sendText(chatId,
        '📋 可用工具：\n' +
        '1. claude — Claude Code\n' +
        '2. codex — Codex CLI\n' +
        '3. gemini — Gemini CLI\n' +
        '发送 `/new <工具名>` 创建会话'
      )
      return
    }

    const toolType = toolArg.toLowerCase()
    if (!validTools.includes(toolType)) {
      await this.adapter?.sendText(chatId, `未知工具: ${toolArg}\n可选: ${validTools.join(', ')}`)
      return
    }

    const workspaces = getWorkspaces()
    const workspace = workspaces.find(w => w.id === chatState.activeWorkspaceId)
    if (!workspace) {
      chatState.activeWorkspaceId = null
      chatState.activeSessionId = null
      await this.adapter?.sendText(chatId, '工作区已不存在，请重新选择')
      return
    }

    const session = createSession(workspace.id, toolType as AIToolType, 'im')

    // Auto-launch
    const launchResult = await launchSession(session.id)
    if (!launchResult.success) {
      await this.adapter?.sendText(chatId, `❌ 启动失败: ${launchResult.error}`)
      return
    }

    // Set as active session
    chatState.activeSessionId = session.id

    // Notify renderer
    this.notifyRendererRefresh()

    // Send v2.0 session card
    const wSessions = getSessionsForWorkspace(workspace.id)
    const sessionIndex = wSessions.findIndex(s => s.id === session.id) + 1
    const output = getSessionOutput(session.id)
    const card = buildSessionCardV2(workspace, session, output, null, sessionIndex)
    const messageId = await this.adapter?.sendCard(chatId, card)

    if (messageId) {
      this.upsertCardMapping({
        workspaceId: workspace.id,
        sessionId: session.id,
        chatId,
        messageId,
        lastSnapshot: `${session.status}|${session.lastActivity}|${output}`,
        updatedAt: Date.now()
      })
    }

  }

  private async handleWorkList(chatId: string): Promise<void> {
    const workspaces = getWorkspaces()
    const sessions = getSessions()
    const card = buildWorkspaceListCard(workspaces, sessions)
    await this.adapter?.sendCard(chatId, card)
  }

  private async handleWorkSwitch(chatId: string, indexStr: string): Promise<void> {
    const workspaces = getWorkspaces()
    const index = parseInt(indexStr, 10) - 1 // User uses 1-based index

    if (isNaN(index) || index < 0 || index >= workspaces.length) {
      await this.adapter?.sendText(
        chatId,
        `无效的工作区编号。当前有 ${workspaces.length} 个工作区，请输入 1~${workspaces.length}。`
      )
      return
    }

    const workspace = workspaces[index]
    const chatState = this.getChatState(chatId)
    chatState.activeWorkspaceId = workspace.id

    // Get sessions for this workspace
    const wSessions = getSessionsForWorkspace(workspace.id)

    // Prompt user to create session if none exist
    if (wSessions.length === 0) {
      await this.adapter?.sendText(chatId, '该工作区暂无会话，请使用 `/new <工具名>` 创建会话，支持工具 claude|codex|gemini ')
      return
    }

    // Auto-select first active session, or last session (most recent)
    let activeSession = wSessions.find((s) => s.status === 'running' || s.status === 'idle')
      || wSessions[wSessions.length - 1]
    chatState.activeSessionId = activeSession?.id || null

    // If the selected session is not active, auto-launch it
    if (activeSession && activeSession.status !== 'running' && activeSession.status !== 'idle') {
      const result = await launchSession(activeSession.id)
      if (result.success) {
        // Re-fetch the session to get updated status
        const refreshed = getSessionsForWorkspace(workspace.id)
        activeSession = refreshed.find((s) => s.id === activeSession!.id) || activeSession
        wSessions.length = 0
        wSessions.push(...refreshed)
        this.notifyRendererRefresh()
      }
    }

    // Send session card directly with switch confirmation in output area
    if (activeSession) {
      const realOutput = getSessionOutput(activeSession.id)
      const allWsSessions = getSessionsForWorkspace(workspace.id)
      const sessionIdx = allWsSessions.findIndex(s => s.id === activeSession.id) + 1
      const switchMsg = `✅ 已切换到工作区: ${workspace.title}，当前会话: #${sessionIdx}`
      const outputForCard = realOutput || switchMsg
      const sessionCard = buildSessionCardV2(workspace, activeSession, outputForCard, parseAuthOptions(realOutput), sessionIdx)
      const sessionMsgId = await this.adapter?.sendCard(chatId, sessionCard)
      if (sessionMsgId) {
        this.upsertCardMapping({
          workspaceId: workspace.id,
          sessionId: activeSession.id,
          chatId,
          messageId: sessionMsgId,
          lastSnapshot: `${activeSession.status}|${activeSession.lastActivity}|${realOutput}`,
          updatedAt: Date.now()
        })
      }
    }
  }

  private async handleSessionList(chatId: string): Promise<void> {
    const chatState = this.getChatState(chatId)
    if (!chatState.activeWorkspaceId) {
      await this.adapter?.sendText(chatId, '请先用 /w <n> 选择工作区')
      return
    }

    const workspaces = getWorkspaces()
    const workspace = workspaces.find((w) => w.id === chatState.activeWorkspaceId)
    if (!workspace) {
      chatState.activeWorkspaceId = null
      chatState.activeSessionId = null
      await this.adapter?.sendText(chatId, '工作区已不存在，请重新选择')
      return
    }

    const wSessions = getSessionsForWorkspace(workspace.id)
    const card = buildWorkspaceDetailCard(workspace, wSessions)
    await this.adapter?.sendCard(chatId, card)
  }

  private async handleSessionSwitch(chatId: string, indexStr: string): Promise<void> {
    const chatState = this.getChatState(chatId)
    if (!chatState.activeWorkspaceId) {
      await this.adapter?.sendText(chatId, '请先用 /w <n> 选择工作区')
      return
    }

    const wSessions = getSessionsForWorkspace(chatState.activeWorkspaceId)
    const index = parseInt(indexStr, 10) - 1

    if (isNaN(index) || index < 0 || index >= wSessions.length) {
      await this.adapter?.sendText(
        chatId,
        `无效的会话编号。当前工作区有 ${wSessions.length} 个会话，请输入 1~${wSessions.length}。`
      )
      return
    }

    const session = wSessions[index]
    chatState.activeSessionId = session.id

    // Send session detail card
    const workspaces = getWorkspaces()
    const workspace = workspaces.find((w) => w.id === chatState.activeWorkspaceId)
    if (!workspace) return

    const realOutput = getSessionOutput(session.id)
    const allSessions = getSessionsForWorkspace(chatState.activeWorkspaceId)
    const sesIdx = allSessions.findIndex(s => s.id === session.id) + 1
    const switchMsg = `✅ 已切换到会话 #${sesIdx}`
    const outputForCard = realOutput || switchMsg
    const card = buildSessionCardV2(workspace, session, outputForCard, parseAuthOptions(realOutput), sesIdx)
    const messageId = await this.adapter?.sendCard(chatId, card)

    if (messageId) {
      this.upsertCardMapping({
        workspaceId: workspace.id,
        sessionId: session.id,
        chatId,
        messageId,
        lastSnapshot: `${session.status}|${session.lastActivity}|${realOutput}`,
        updatedAt: Date.now()
      })
    }
  }

  private async handleExit(chatId: string): Promise<void> {
    const chatState = this.getChatState(chatId)
    if (!chatState.activeSessionId) {
      await this.adapter?.sendText(chatId, '当前没有活跃会话')
      return
    }

    await stopSession(chatState.activeSessionId)
    this.notifyRendererRefresh()

    await this.adapter?.sendText(chatId, '✅ 已退出当前会话')
    chatState.activeSessionId = null
  }

  private async handleStatus(chatId: string): Promise<void> {
    const workspaces = getWorkspaces()
    const sessions = getSessions()
    const chatState = this.chatStates.get(chatId)
    const card = buildStatusCard(workspaces, sessions, chatState)
    await this.adapter?.sendCard(chatId, card)
  }

  private async handleStdinForward(chatId: string, text: string, messageId: string): Promise<void> {
    const chatState = this.getChatState(chatId)
    if (!chatState.activeSessionId) return

    const result = await writeToSession(chatState.activeSessionId, text)
    if (result.success) {
      // Use emoji reaction instead of a text reply
      if (this.adapter?.addReaction) {
        await this.adapter.addReaction(messageId, 'Typing')
      }
    } else {
      await this.adapter?.sendText(chatId, `发送失败: ${result.error}`)
    }

    // Auto-refresh the session detail card
    const mapping = this.cardMappings.find(
      (m) => m.sessionId === chatState.activeSessionId && m.chatId === chatId
    )
    if (mapping) {
      if (result.success) this.appendInputHistory(mapping, text)
      this.scheduleMultiRefresh(mapping, chatState.activeSessionId)
    }
  }

  // ── App management handlers ──

  private async handleAppList(chatId: string): Promise<void> {
    const apps = listSubApps()
    const card = buildAppListCard(apps)
    await this.adapter?.sendCard(chatId, card)
  }

  private async handleAppRun(chatId: string, indexStr: string, extraArgs: string[]): Promise<void> {
    if (!indexStr) {
      await this.handleAppList(chatId)
      return
    }

    const apps = listSubApps()
    const index = parseInt(indexStr, 10) - 1

    if (isNaN(index) || index < 0 || index >= apps.length) {
      await this.adapter?.sendText(
        chatId,
        `无效的应用编号。当前有 ${apps.length} 个应用，请输入 1~${apps.length}。`
      )
      return
    }

    const app = apps[index]
    const appPath = getSubAppPath(app.manifest.id)
    if (!appPath) {
      await this.adapter?.sendText(chatId, `❌ 找不到应用路径：${app.manifest.name}`)
      return
    }

    // Map positional extraArgs to named params
    const paramDefs = (app.manifest.params as Array<{ name: string; required?: boolean; default?: unknown }> | undefined) ?? []
    const requiredParams = paramDefs.filter((p) => p.required !== false)

    if (requiredParams.length > 0 && extraArgs.length === 0) {
      const paramNames = requiredParams.map((p) => `<${p.name}>`).join(' ')
      await this.adapter?.sendText(
        chatId,
        `📋 **${app.manifest.name}** 需要参数：\n\`/a ${index + 1} ${paramNames}\`\n\n参数说明：\n${paramDefs.map((p) => `• \`${p.name}\`${p.required !== false ? ' (必填)' : ' (可选)'}`).join('\n')}`
      )
      return
    }

    // Build params object from positional args
    const params: Record<string, unknown> = {}
    for (let i = 0; i < paramDefs.length; i++) {
      if (extraArgs[i] !== undefined) {
        params[paramDefs[i].name] = extraArgs[i]
      } else if (paramDefs[i].default !== undefined) {
        params[paramDefs[i].name] = paramDefs[i].default
      }
    }

    // Send running card
    const runningCard = buildAppRunningCard(app.manifest.name)
    const runCardId = await this.adapter?.sendCard(chatId, runningCard)

    const pythonPath = (settingsStore.get('pythonPath') as string) || 'python3'
    const sdkPath = getPythonSdkPath()
    const taskId = randomUUID()

    // Use active workspace if available, otherwise use placeholder
    const chatState = this.getChatState(chatId)
    const workspaces = getWorkspaces()
    const activeWorkspace = workspaces.find((w) => w.id === chatState.activeWorkspaceId)
    const workspace = activeWorkspace
      ? { id: activeWorkspace.id, name: activeWorkspace.title, path: activeWorkspace.workingDir }
      : { id: 'im', name: 'IM Task', path: '' }

    const outputLines: string[] = []

    executeSubAppWithCallbacks(
      taskId,
      app.manifest.name,
      appPath,
      app.manifest.entry,
      params,
      workspace,
      pythonPath,
      sdkPath,
      {
        onOutput: (message) => {
          outputLines.push(message)
          if (outputLines.length > 20) outputLines.shift()
        },
        onComplete: async (success, summary) => {
          const resultCard = buildAppResultCard(
            app.manifest.name,
            success,
            summary,
            outputLines.slice(-8).join('\n')
          )
          if (runCardId && this.adapter) {
            try {
              await this.adapter.updateCard(chatId, runCardId, resultCard)
            } catch {
              await this.adapter?.sendCard(chatId, resultCard)
            }
          } else {
            await this.adapter?.sendCard(chatId, resultCard)
          }
        }
      }
    )
  }

  private async handleAppMarket(chatId: string, keywords?: string): Promise<void> {
    try {
      const apps = keywords
        ? await searchMarketApps(keywords)
        : await listRecentMarketApps()
      const card = buildAppMarketCard(apps, keywords)
      await this.adapter?.sendCard(chatId, card)
    } catch (err) {
      await this.adapter?.sendText(chatId, `❌ 获取应用市场失败：${err}`)
    }
  }

  private async handleAppInstall(chatId: string, appId: string): Promise<void> {
    if (!appId) {
      await this.adapter?.sendText(chatId, '请提供应用 ID，例如：`/app install com.example.myapp`')
      return
    }
    await this.adapter?.sendText(chatId, `⏳ 正在安装 \`${appId}\`，请稍候…`)
    const result = await installMarketApp(appId)
    if (result.success) {
      await this.adapter?.sendText(chatId, `✅ 安装成功：**${result.name || appId}**\n\n发送 \`/app\` 查看已安装应用列表。`)
    } else {
      await this.adapter?.sendText(chatId, `❌ 安装失败：${result.error}`)
    }
  }

  private async handleChat(chatId: string, text: string): Promise<void> {
    if (!text.trim()) {
      await this.adapter?.sendText(chatId, '请输入内容，例如：`/chat 如何优化代码性能？`')
      return
    }

    const configs = getAiModelConfigs()
    if (!configs || configs.length === 0) {
      await this.adapter?.sendText(chatId, '❌ 尚未配置 AI 模型，请在桌面端设置中添加 AI 模型配置。')
      return
    }

    const { configId: lastConfigId, modelId: lastModelId } = getLastChatModel()
    const config = (lastConfigId && configs.find((c) => c.id === lastConfigId)) || configs[0]
    const modelId = (lastModelId && config.models?.includes(lastModelId) ? lastModelId : null)
      ?? config.models?.[0]
      ?? config.name
    const provider = config.provider.toLowerCase()

    try {
      let reply = ''
      const messages = [{ role: 'user' as const, content: text }]

      if (provider === 'claude') {
        const { default: Anthropic } = await import('@anthropic-ai/sdk')
        const client = new Anthropic({ apiKey: config.apiKey, baseURL: config.endpoint || undefined })
        const resp = await client.messages.create({
          model: modelId,
          max_tokens: 1024,
          messages
        })
        reply = resp.content[0]?.type === 'text' ? resp.content[0].text : ''
      } else if (provider === 'google') {
        const { GoogleGenerativeAI } = await import('@google/generative-ai')
        const genAI = new GoogleGenerativeAI(config.apiKey)
        const model = genAI.getGenerativeModel({ model: modelId })
        const result = await model.generateContent(text)
        reply = result.response.text()
      } else {
        const { default: OpenAI, AzureOpenAI } = await import('openai')
        const client = provider === 'azure-openai'
          ? new AzureOpenAI({ apiKey: config.apiKey, apiVersion: config.apiVersion || '2025-04-01-preview', endpoint: config.endpoint })
          : new OpenAI({ apiKey: config.apiKey, baseURL: config.endpoint || undefined })
        const resp = await client.chat.completions.create({
          model: modelId,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          max_tokens: 1024
        })
        reply = resp.choices[0]?.message?.content?.trim() || ''
      }

      await this.adapter?.sendText(chatId, reply || '(无回复)')
    } catch (err) {
      await this.adapter?.sendText(chatId, `❌ AI 调用失败：${err}`)
    }
  }

  // ── Card action callbacks ──

  private async handleCardCallback(cb: IMCardCallback): Promise<void> {
    try {
      switch (cb.actionTag) {
        case 'interrupt_session':
          if (cb.actionValue) {
            interruptSession(cb.actionValue)
            const intMapping = this.cardMappings.find(m => m.sessionId === cb.actionValue)
            if (intMapping) {
              setTimeout(() => this.refreshCard(intMapping).catch(() => {}), 1000)
            }
          }
          break

        case 'stop_session':
          if (cb.actionValue) {
            await stopSession(cb.actionValue)
            this.notifyRendererRefresh()
            // Refresh the card
            const mapping = this.cardMappings.find(
              (m) => m.sessionId === cb.actionValue
            )
            if (mapping) {
              await this.refreshCard(mapping)
            }
          }
          break

        case 'launch_session':
          if (cb.actionValue) {
            await launchSession(cb.actionValue)
            this.notifyRendererRefresh()
            const mapping = this.cardMappings.find(
              (m) => m.sessionId === cb.actionValue
            )
            if (mapping) {
              setTimeout(() => this.refreshCard(mapping).catch(() => {}), 1000)
            }
          }
          break

        case 'switch_workspace':
          if (cb.actionValue && cb.chatId) {
            await this.handleWorkSwitch(cb.chatId, cb.actionValue)
          }
          break

        case 'send_to_session': {
          // value format: "{sessionId}:{text}"
          const colonIdx = (cb.actionValue ?? '').indexOf(':')
          if (colonIdx > 0) {
            const sessionId = cb.actionValue!.slice(0, colonIdx)
            const text = cb.actionValue!.slice(colonIdx + 1)
            await writeToSession(sessionId, text)
            this.notifyRendererRefresh()
            const mapping = this.cardMappings.find(m => m.sessionId === sessionId)
            if (mapping) {
              setTimeout(() => this.refreshCard(mapping).catch(() => {}), 1000)
            }
          }
          break
        }

        case 'form_input': {
          // Form submit: sessionId in actionValue, text in formValue.user_input
          const sessionId = cb.actionValue
          const text = (cb.formValue?.user_input || '').trim()
          console.log('[IMBridge] form_input callback:', { sessionId, text, formValue: cb.formValue })
          if (sessionId && text) {
            const result = await writeToSession(sessionId, text)
            console.log('[IMBridge] writeToSession result:', result)
            if (result.success) {
              this.notifyRendererRefresh()
              const mapping = this.cardMappings.find(m => m.sessionId === sessionId)
              if (mapping) {
                this.appendInputHistory(mapping, text)
                this.scheduleMultiRefresh(mapping, sessionId)
              }
            }
          } else {
            console.warn('[IMBridge] form_input: missing sessionId or text', { sessionId, text, cb })
          }
          break
        }
      }
    } catch (err) {
      console.error('[IMBridge] Error handling card callback:', cb.actionTag, err)
    }
  }

  // ── 15-second periodic card updates ──

  private startUpdateTimer(): void {
    this.stopUpdateTimer()
    this.updateTimer = setInterval(() => {
      this.refreshAllActiveCards().catch((err) =>
        console.error('[IMBridge] Card refresh error:', err)
      )
    }, 5_000)
  }

  private stopUpdateTimer(): void {
    if (this.updateTimer) {
      clearInterval(this.updateTimer)
      this.updateTimer = null
    }
  }

  private async refreshAllActiveCards(): Promise<void> {
    if (!this.adapter || this.adapter.getStatus().state !== 'connected') return

    const sessions = getSessions()

    for (const mapping of this.cardMappings) {
      if (!mapping.sessionId) continue

      const session = sessions.find((s) => s.id === mapping.sessionId)
      if (!session) continue

      // Skip closed sessions — nothing will change
      if (session.status === 'closed') continue

      const output = getSessionOutput(session.id)
      // Include status+activity in snapshot so state transitions (e.g. running→idle)
      // trigger a refresh even when raw output hasn't changed
      const snapshot = `${session.status}|${session.lastActivity}|${output}`
      if (snapshot === mapping.lastSnapshot) continue

      // Parse previous state to detect transitions
      const [prevStatus, prevActivity] = (mapping.lastSnapshot || '').split('|')

      const interactiveActivities = ['auth_request', 'waiting_input']
      const isInteractive = interactiveActivities.includes(session.lastActivity)
      const wasInteractive = interactiveActivities.includes(prevActivity)

      const isFinished = session.status === 'completed' || session.status === 'error'
      const wasFinished = prevStatus === 'completed' || prevStatus === 'error'

      try {
        if (isInteractive && !wasInteractive) {
          // Just entered an interactive state — send new card to top of chat with action buttons
          await this.proactiveInteractionCard(mapping, session, output)
        } else if (isFinished && !wasFinished) {
          // Session just completed or errored — send a final summary card
          await this.proactiveCompletionCard(mapping, session, output)
        } else {
          await this.refreshCard(mapping)
        }
        mapping.lastSnapshot = snapshot
      } catch (err) {
        console.error(
          '[IMBridge] Failed to refresh card for session',
          mapping.sessionId,
          err
        )
      }
    }
  }

  /**
   * Send a new card when session enters an interactive state (auth_request / waiting_input).
   * Updates the mapping to track the new message so future refreshes update it.
   */
  private async proactiveInteractionCard(
    mapping: CardMapping,
    session: ReturnType<typeof getSessions>[number],
    output: string
  ): Promise<void> {
    const workspace = getWorkspaces().find((w) => w.id === mapping.workspaceId)
    if (!workspace) return

    const authOptions = parseAuthOptions(output)
    const wSessions = getSessionsForWorkspace(workspace.id)
    const sessionIndex = wSessions.findIndex(s => s.id === session.id) + 1
    // Entering waiting_input means AI finished the last input — mark it done
    if (session.lastActivity === 'waiting_input') this.markOldestInputDone(mapping)
    const card = buildSessionCardV2(workspace, session, output, authOptions, sessionIndex, mapping.inputHistory)
    const newMessageId = await this.adapter?.sendCard(mapping.chatId, card)
    if (newMessageId) {
      // Point the mapping at the new card so future refreshes update it
      mapping.messageId = newMessageId
    }
    mapping.updatedAt = Date.now()
  }

  /**
   * Send a new summary card when session transitions to completed or error.
   */
  private async proactiveCompletionCard(
    mapping: CardMapping,
    session: ReturnType<typeof getSessions>[number],
    output: string
  ): Promise<void> {
    const workspace = getWorkspaces().find((w) => w.id === mapping.workspaceId)
    if (!workspace) return

    const card = buildCompletionCard(workspace, session, output)
    await this.adapter?.sendCard(mapping.chatId, card)
    mapping.updatedAt = Date.now()
  }

  private async refreshCard(mapping: CardMapping): Promise<void> {
    const workspaces = getWorkspaces()
    const workspace = workspaces.find((w) => w.id === mapping.workspaceId)
    if (!workspace) return

    if (mapping.sessionId) {
      const sessions = getSessions()
      const session = sessions.find((s) => s.id === mapping.sessionId)
      if (!session) return

      const output = getSessionOutput(session.id)
      const authOptions = parseAuthOptions(output)
      const wSessions = getSessionsForWorkspace(workspace.id)
      const sessionIndex = wSessions.findIndex(s => s.id === session.id) + 1

      // Mark the oldest pending input as done when AI is ready for next input
      const readyForInput = session.lastActivity === 'waiting_input' || session.status === 'idle'
      if (readyForInput) this.markOldestInputDone(mapping)

      const card = buildSessionCardV2(workspace, session, output, authOptions, sessionIndex, mapping.inputHistory)
      await this.adapter?.updateCard(mapping.chatId, mapping.messageId, card)
      mapping.lastSnapshot = `${session.status}|${session.lastActivity}|${output}`
    } else {
      const wSessions = getSessionsForWorkspace(workspace.id)
      const card = buildWorkspaceDetailCard(workspace, wSessions)
      await this.adapter?.updateCard(mapping.chatId, mapping.messageId, card)
    }

    mapping.updatedAt = Date.now()
  }

  // ── Input history helpers ──

  /**
   * Schedule multiple card refreshes at increasing intervals after input is sent.
   * Cancels any previously pending refresh timers for the same session.
   */
  private scheduleMultiRefresh(mapping: CardMapping, sessionId: string): void {
    // Cancel any previously pending timers for this session
    const existing = this.pendingRefreshTimers.get(sessionId)
    if (existing) {
      for (const t of existing) clearTimeout(t)
    }

    const timers: ReturnType<typeof setTimeout>[] = []
    for (const delay of [1000, 3000, 8000, 15000]) {
      timers.push(
        setTimeout(() => this.refreshCard(mapping).catch(() => {}), delay)
      )
    }
    this.pendingRefreshTimers.set(sessionId, timers)
  }

  /**
   * Append a new user input to the mapping's history.
   * The new entry starts as undone (🔄); previous entries remain as-is.
   * Keeps only the last 20 entries.
   */
  private appendInputHistory(mapping: CardMapping, text: string): void {
    if (!mapping.inputHistory) mapping.inputHistory = []
    mapping.inputHistory.push({ text, done: false })
    if (mapping.inputHistory.length > 20) {
      mapping.inputHistory = mapping.inputHistory.slice(-20)
    }
  }

  /**
   * Mark the oldest undone history entry as done (✅).
   * Called when the session enters a state that means the AI finished processing
   * (e.g. waiting_input, idle).
   */
  private markOldestInputDone(mapping: CardMapping): void {
    const entry = mapping.inputHistory?.find((e: InputHistoryEntry) => !e.done)
    if (entry) entry.done = true
  }

  // ── Card mapping management ──

  private upsertCardMapping(mapping: CardMapping): void {
    const existing = this.cardMappings.findIndex(
      (m) => m.workspaceId === mapping.workspaceId && m.chatId === mapping.chatId && m.sessionId === mapping.sessionId
    )
    if (existing >= 0) {
      this.cardMappings[existing] = mapping
    } else {
      this.cardMappings.push(mapping)
    }
  }

  // ── IPC push helpers ──

  private broadcastStatus(status: IMConnectionStatus): void {
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      win.webContents.send('ai-workbench:im-status-changed', status)
    }
  }

  private notifyRendererRefresh(): void {
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      win.webContents.send('ai-workbench:data-changed')
    }
  }
}

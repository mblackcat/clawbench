import { ipcMain, BrowserWindow } from 'electron'
import {
  streamChat,
  cancelChat,
  generateTitle,
  getModelConfig,
} from '../services/ai.service'
import type { AttachmentInfo, ToolDefinition, ChatMessage } from '../services/ai.service'
import {
  streamAgentQuery,
  resolveToolApproval,
  resolveClientToolResult,
  type AgentQueryParams,
} from '../services/agent/agent-query.service'
import { executeAgentToolBatch } from '../services/agent/agent-tools'
import { needsCompact, compactMessages } from '../services/agent/context-compact'

export function registerAiIpc(): void {
  ipcMain.handle(
    'ai:stream-chat',
    async (
      event,
      params: {
        modelConfigId: string
        messages: Array<{ role: string; content: string; toolCallId?: string; toolCalls?: any[] }>
        modelId?: string
        attachments?: AttachmentInfo[]
        tools?: ToolDefinition[]
        enableThinking?: boolean
        webSearchEnabled?: boolean
      }
    ) => {
      const window = BrowserWindow.fromWebContents(event.sender)
      if (!window) throw new Error('No window found')

      return streamChat(
        window,
        params.modelConfigId,
        params.messages as ChatMessage[],
        params.modelId,
        params.attachments,
        params.tools,
        params.enableThinking,
        params.webSearchEnabled
      )
    }
  )

  /** Claude Code–style multi-turn agent loop (main process owns tools). */
  ipcMain.handle(
    'ai:stream-agent-query',
    async (event, params: AgentQueryParams) => {
      const window = BrowserWindow.fromWebContents(event.sender)
      if (!window) throw new Error('No window found')
      return streamAgentQuery(window, params)
    }
  )

  ipcMain.handle(
    'ai:approve-tool',
    async (_event, params: { taskId: string; toolCallId: string }) => {
      return resolveToolApproval(params.taskId, params.toolCallId, true)
    }
  )

  ipcMain.handle(
    'ai:reject-tool',
    async (_event, params: { taskId: string; toolCallId: string }) => {
      return resolveToolApproval(params.taskId, params.toolCallId, false)
    }
  )

  // Client tool result (Editor / Terminal) or legacy approval alias
  ipcMain.handle(
    'ai:tool-result',
    async (
      _event,
      params: { taskId: string; toolCallId: string; result?: string; isError?: boolean; approved?: boolean }
    ) => {
      // Prefer client-tool waiter when a result payload is present
      if (typeof params.result === 'string') {
        if (
          resolveClientToolResult(
            params.taskId,
            params.toolCallId,
            params.result,
            !!params.isError
          )
        ) {
          return true
        }
      }
      // Approval resolution when used from agent loop
      if (params.approved === false || params.isError) {
        return resolveToolApproval(params.taskId, params.toolCallId, false)
      }
      return resolveToolApproval(params.taskId, params.toolCallId, true)
    }
  )

  /**
   * Hybrid builtin chat: execute tools on main with shared catalog / partition / budget.
   */
  ipcMain.handle(
    'ai:execute-agent-tools',
    async (
      _event,
      params: {
        calls: Array<{ id: string; name: string; input: Record<string, any> }>
        toolsEnabled?: boolean
        webSearchEnabled?: boolean
        feishuKitsEnabled?: boolean
        attachmentPaths?: string[]
        fingerprints?: Record<string, number>
      }
    ) => {
      return executeAgentToolBatch(params.calls || [], {
        toolsEnabled: params.toolsEnabled,
        webSearchEnabled: params.webSearchEnabled,
        feishuKitsEnabled: params.feishuKitsEnabled,
        attachmentPaths: params.attachmentPaths,
        fingerprints: params.fingerprints,
      })
    }
  )

  /** Optional compact for hybrid builtin path (uses local model config when available). */
  ipcMain.handle(
    'ai:compact-messages',
    async (
      _event,
      params: {
        messages: ChatMessage[]
        modelConfigId?: string
        modelId?: string
      }
    ) => {
      if (!needsCompact(params.messages || [])) {
        return { messages: params.messages, compacted: false }
      }
      const config = params.modelConfigId ? getModelConfig(params.modelConfigId) : undefined
      if (!config) {
        // No local model for summarization — drop oldest non-system messages as soft compact
        const system = (params.messages || []).filter((m) => m.role === 'system')
        const rest = (params.messages || []).filter((m) => m.role !== 'system')
        const keep = rest.slice(-12)
        return {
          messages: [
            ...system,
            {
              role: 'user' as const,
              content:
                '[System: conversation context compacted — older turns dropped (no local model for LLM summary)]',
            },
            ...keep,
          ],
          compacted: true,
        }
      }
      return compactMessages(params.messages, config, params.modelId || config.models[0] || config.name)
    }
  )

  ipcMain.handle('ai:cancel-chat', async (_event, taskId: string) => {
    return cancelChat(taskId)
  })

  ipcMain.handle(
    'ai:generate-title',
    async (
      _event,
      params: {
        modelConfigId: string
        messages: Array<{ role: string; content: string }>
        modelId?: string
      }
    ) => {
      return generateTitle(
        params.modelConfigId,
        params.messages as ChatMessage[],
        params.modelId
      )
    }
  )
}

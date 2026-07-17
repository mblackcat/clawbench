import { ipcMain, BrowserWindow } from 'electron'
import { streamChat, cancelChat, generateTitle } from '../services/ai.service'
import type { AttachmentInfo, ToolDefinition, ChatMessage } from '../services/ai.service'
import {
  streamAgentQuery,
  resolveToolApproval,
  type AgentQueryParams,
} from '../services/agent/agent-query.service'

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

  // Legacy alias used by older preload bindings
  ipcMain.handle(
    'ai:tool-result',
    async (
      _event,
      params: { taskId: string; toolCallId: string; result?: string; isError?: boolean; approved?: boolean }
    ) => {
      // Treat as approval resolution when used from agent loop
      if (params.approved === false || params.isError) {
        return resolveToolApproval(params.taskId, params.toolCallId, false)
      }
      return resolveToolApproval(params.taskId, params.toolCallId, true)
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

import { ipcMain, BrowserWindow } from 'electron'
import { streamChat, cancelChat, generateTitle } from '../services/ai.service'
import type { AttachmentInfo, ToolDefinition, ChatMessage } from '../services/ai.service'

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

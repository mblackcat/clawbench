import { ipcMain } from 'electron'
import {
  readMemory,
  writeMemory,
  readAllMemories,
  readStats,
  processFeedback,
  restoreSoulDefault,
  getMemoryDir,
  getStatsSnippet,
} from '../services/agent-memory.service'

export function registerAgentMemoryIpc(): void {
  ipcMain.handle('agent:read-memory', async (_event, filename: string) => {
    return readMemory(filename)
  })

  ipcMain.handle('agent:write-memory', async (_event, filename: string, content: string) => {
    return writeMemory(filename, content)
  })

  ipcMain.handle('agent:read-all-memories', async () => {
    return readAllMemories()
  })

  ipcMain.handle('agent:read-stats', async () => {
    return readStats()
  })

  ipcMain.handle('agent:stats-snippet', async () => {
    return getStatsSnippet()
  })

  ipcMain.handle('agent:process-feedback', async (_event, data: {
    messageId: string
    type: 'up' | 'down'
    reason?: string
    snippet: string
  }) => {
    // Fire-and-forget: don't await, let it run in background
    processFeedback(data).catch(() => {})
    return { ok: true }
  })

  ipcMain.handle('agent:restore-soul-default', async () => {
    return restoreSoulDefault()
  })

  ipcMain.handle('agent:get-memory-dir', async () => {
    return getMemoryDir()
  })
}

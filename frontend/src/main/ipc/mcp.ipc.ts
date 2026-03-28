import { ipcMain } from 'electron'
import { mcpClientManager } from '../services/mcp/mcp-client.service'
import { getMCPServers, saveMCPServer, deleteMCPServer } from '../store/mcp.store'
import { executeTool } from '../services/tool-executor.service'
import type { MCPServerConfig } from '../services/mcp/mcp-types'

export function registerMcpIpc(): void {
  // CRUD
  ipcMain.handle('mcp:get-servers', async () => {
    return getMCPServers()
  })

  ipcMain.handle('mcp:save-server', async (_event, config: MCPServerConfig) => {
    saveMCPServer(config)
    return { success: true }
  })

  ipcMain.handle('mcp:delete-server', async (_event, id: string) => {
    await mcpClientManager.disconnect(id)
    deleteMCPServer(id)
    return { success: true }
  })

  // Connection management
  ipcMain.handle('mcp:connect', async (_event, id: string) => {
    const servers = getMCPServers()
    const config = servers.find((s) => s.id === id)
    if (!config) throw new Error(`MCP server ${id} not found`)
    const tools = await mcpClientManager.connect(config)
    // Persist enabled state
    if (!config.enabled) {
      saveMCPServer({ ...config, enabled: true })
    }
    return { tools }
  })

  ipcMain.handle('mcp:disconnect', async (_event, id: string) => {
    await mcpClientManager.disconnect(id)
    // Persist disabled state
    const servers = getMCPServers()
    const config = servers.find((s) => s.id === id)
    if (config && config.enabled) {
      saveMCPServer({ ...config, enabled: false })
    }
    return { success: true }
  })

  // Tools
  ipcMain.handle('mcp:list-tools', async () => {
    return mcpClientManager.getAvailableTools()
  })

  ipcMain.handle(
    'mcp:call-tool',
    async (_event, params: { serverId: string; toolName: string; args: Record<string, any> }) => {
      // Handle built-in tools
      if (params.serverId === '__builtin__') {
        const result = await executeTool(params.toolName, params.args)
        return { content: result.output || result.error || '', isError: result.isError }
      }
      return mcpClientManager.callTool(params.serverId, params.toolName, params.args)
    }
  )

  // Status
  ipcMain.handle('mcp:get-status', async () => {
    return mcpClientManager.getStatus()
  })

  // Connect all enabled servers on startup
  ipcMain.handle('mcp:connect-all-enabled', async () => {
    const servers = getMCPServers().filter((s) => s.enabled)
    const results: Array<{ id: string; success: boolean; error?: string }> = []
    for (const server of servers) {
      try {
        await mcpClientManager.connect(server)
        results.push({ id: server.id, success: true })
      } catch (error: any) {
        results.push({ id: server.id, success: false, error: error.message })
      }
    }
    return results
  })
}

import Store from 'electron-store'
import type { MCPServerConfig } from '../services/mcp/mcp-types'

interface MCPStoreSchema {
  mcpServers: MCPServerConfig[]
}

export const mcpStore = new Store<MCPStoreSchema>({
  name: 'mcp-config',
  defaults: {
    mcpServers: [],
  },
})

export function getMCPServers(): MCPServerConfig[] {
  return mcpStore.get('mcpServers') || []
}

export function saveMCPServer(config: MCPServerConfig): void {
  const servers = getMCPServers()
  const idx = servers.findIndex((s) => s.id === config.id)
  if (idx >= 0) {
    servers[idx] = config
  } else {
    servers.push(config)
  }
  mcpStore.set('mcpServers', servers)
}

export function deleteMCPServer(id: string): void {
  const servers = getMCPServers().filter((s) => s.id !== id)
  mcpStore.set('mcpServers', servers)
}

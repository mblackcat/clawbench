export interface MCPServerConfig {
  id: string
  name: string
  transportType: 'stdio' | 'sse'
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  enabled: boolean
}

export interface MCPToolInfo {
  name: string
  description: string
  inputSchema: Record<string, any>
  serverId: string
  serverName: string
}

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import type { MCPServerConfig, MCPToolInfo } from './mcp-types'
import { detectVisionTool, findImageInputParam } from './mcp-types'
import * as fs from 'fs'
import * as path from 'path'

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
}
import * as logger from '../../utils/logger'

interface ConnectedServer {
  config: MCPServerConfig
  client: Client
  transport: StdioClientTransport | SSEClientTransport
  tools: MCPToolInfo[]
}

class MCPClientManager {
  private servers: Map<string, ConnectedServer> = new Map()

  /**
   * Connect to an MCP server
   */
  async connect(config: MCPServerConfig): Promise<MCPToolInfo[]> {
    // Disconnect existing connection if any
    if (this.servers.has(config.id)) {
      await this.disconnect(config.id)
    }

    logger.info(`Connecting to MCP server: ${config.name} (${config.transportType})`)

    try {
      let transport: StdioClientTransport | SSEClientTransport

      if (config.transportType === 'stdio') {
        if (!config.command) {
          throw new Error('stdio transport requires a command')
        }
        transport = new StdioClientTransport({
          command: config.command,
          args: config.args || [],
          env: config.env ? { ...process.env, ...config.env } as Record<string, string> : undefined,
        })
      } else {
        if (!config.url) {
          throw new Error('SSE transport requires a URL')
        }
        transport = new SSEClientTransport(new URL(config.url))
      }

      const client = new Client(
        { name: 'clawbench-ai-chat', version: '1.0.0' },
        { capabilities: {} }
      )

      await client.connect(transport)

      // List available tools
      const toolsResult = await client.listTools()
      const tools: MCPToolInfo[] = (toolsResult.tools || []).map((t) => {
        const base = {
          name: t.name,
          description: t.description || '',
          inputSchema: (t.inputSchema || {}) as Record<string, any>,
          serverId: config.id,
          serverName: config.name,
        }
        return { ...base, isVisionTool: detectVisionTool(base) }
      })

      this.servers.set(config.id, { config, client, transport, tools })
      logger.info(`Connected to MCP server: ${config.name}, ${tools.length} tools available`)

      return tools
    } catch (error: any) {
      logger.error(`Failed to connect to MCP server ${config.name}:`, error)
      throw error
    }
  }

  /**
   * Disconnect from an MCP server
   */
  async disconnect(serverId: string): Promise<void> {
    const server = this.servers.get(serverId)
    if (server) {
      try {
        await server.client.close()
      } catch (error) {
        logger.error(`Error disconnecting from MCP server ${server.config.name}:`, error)
      }
      this.servers.delete(serverId)
    }
  }

  /**
   * Disconnect from all servers
   */
  async disconnectAll(): Promise<void> {
    for (const [id] of this.servers) {
      await this.disconnect(id)
    }
  }

  /**
   * Get all available tools from all connected servers
   */
  getAvailableTools(): MCPToolInfo[] {
    const allTools: MCPToolInfo[] = []
    for (const server of this.servers.values()) {
      allTools.push(...server.tools)
    }
    return allTools
  }

  /**
   * Call a tool on a specific server
   */
  async callTool(
    serverId: string,
    toolName: string,
    args: Record<string, any>
  ): Promise<{ content: string; isError: boolean }> {
    const server = this.servers.get(serverId)
    if (!server) {
      throw new Error(`MCP server ${serverId} not connected`)
    }

    try {
      const result = await server.client.callTool({ name: toolName, arguments: args })

      // Extract text content from the result
      const textParts = (result.content as any[])
        ?.filter((c: any) => c.type === 'text')
        .map((c: any) => c.text) || []

      return {
        content: textParts.join('\n') || JSON.stringify(result.content),
        isError: !!result.isError,
      }
    } catch (error: any) {
      logger.error(`Error calling MCP tool ${toolName} on ${server.config.name}:`, error)
      return {
        content: error.message || 'Tool execution failed',
        isError: true,
      }
    }
  }

  /**
   * Call a tool that was auto-registered as a "vision fallback" for a non-vision model.
   * The model can only decide TO call this tool — it can't generate real image bytes as
   * an argument — so we locate the schema's image-like parameter and overwrite whatever
   * placeholder the model produced with the actual attached image(s), read fresh from disk.
   */
  async callToolWithImageInjection(
    serverId: string,
    toolName: string,
    args: Record<string, any>,
    attachmentPaths: string[]
  ): Promise<{ content: string; isError: boolean }> {
    const server = this.servers.get(serverId)
    if (!server) {
      throw new Error(`MCP server ${serverId} not connected`)
    }
    const tool = server.tools.find((t) => t.name === toolName)
    const imageParam = tool ? findImageInputParam(tool.inputSchema) : undefined

    if (!imageParam || attachmentPaths.length === 0) {
      // No recognizable image param (or nothing to inject) — fall back to a plain call.
      return this.callTool(serverId, toolName, args)
    }

    const encode = (filePath: string): string | undefined => {
      try {
        if (!fs.existsSync(filePath)) return undefined
        const data = fs.readFileSync(filePath).toString('base64')
        if (imageParam.wantsBase64Only) return data
        const mime = MIME_BY_EXT[path.extname(filePath).toLowerCase()] || 'application/octet-stream'
        return `data:${mime};base64,${data}`
      } catch (err) {
        logger.error(`Failed to read attachment for MCP vision tool injection: ${filePath}`, err)
        return undefined
      }
    }

    const injectedArgs = { ...args }
    if (imageParam.isArray) {
      const encoded = attachmentPaths.map(encode).filter((v): v is string => !!v)
      if (encoded.length > 0) injectedArgs[imageParam.key] = encoded
    } else {
      const encoded = encode(attachmentPaths[0])
      if (encoded) injectedArgs[imageParam.key] = encoded
    }

    return this.callTool(serverId, toolName, injectedArgs)
  }

  /**
   * Find which server owns a tool
   */
  findToolServer(toolName: string): string | undefined {
    for (const server of this.servers.values()) {
      if (server.tools.some((t) => t.name === toolName)) {
        return server.config.id
      }
    }
    return undefined
  }

  /**
   * Get connection status of all servers
   */
  getStatus(): Array<{ id: string; name: string; connected: boolean; toolCount: number }> {
    return Array.from(this.servers.values()).map((s) => ({
      id: s.config.id,
      name: s.config.name,
      connected: true,
      toolCount: s.tools.length,
    }))
  }
}

// Singleton instance
export const mcpClientManager = new MCPClientManager()

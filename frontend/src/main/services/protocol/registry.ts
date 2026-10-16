import type { ProtocolCommandConfig } from './types'
import { appCommand } from './commands/app.command'
import { authCommand } from './commands/auth.command'
import { installCommand } from './commands/install.command'

/**
 * Protocol command registry.
 *
 * Add new commands by appending to DEFAULT_PROTOCOL_COMMANDS or calling
 * protocolRegistry.register(). There is deliberately no generic "run a shell
 * command" command: a URL can be triggered by any web page, so that would be
 * remote code execution.
 */
export const DEFAULT_PROTOCOL_COMMANDS: ProtocolCommandConfig[] = [
  appCommand,
  authCommand,
  installCommand
]

class ProtocolCommandRegistry {
  private commands = new Map<string, ProtocolCommandConfig>()

  constructor() {
    this.initDefaultCommands()
  }

  /**
   * 初始化内置默认命令
   */
  public initDefaultCommands(): void {
    for (const cmd of DEFAULT_PROTOCOL_COMMANDS) {
      this.register(cmd)
    }
  }

  /**
   * 注册协议命令配置
   */
  public register(config: ProtocolCommandConfig): void {
    const primaryKey = config.name.toLowerCase().trim()
    this.commands.set(primaryKey, config)

    if (config.aliases && Array.isArray(config.aliases)) {
      for (const alias of config.aliases) {
        const aliasKey = alias.toLowerCase().trim()
        if (aliasKey) {
          this.commands.set(aliasKey, config)
        }
      }
    }
  }

  /**
   * 根据一级 action 名称查询命令配置
   */
  public find(action: string): ProtocolCommandConfig | undefined {
    if (!action) return undefined
    return this.commands.get(action.toLowerCase().trim())
  }

  /**
   * 获取所有已注册的唯一命令配置列表
   */
  public getAll(): ProtocolCommandConfig[] {
    const unique = new Set<ProtocolCommandConfig>()
    for (const cmd of this.commands.values()) {
      unique.add(cmd)
    }
    return Array.from(unique)
  }

  /**
   * 清空并重新加载（供单测或动态重置使用）
   */
  public reset(): void {
    this.commands.clear()
    this.initDefaultCommands()
  }
}

export const protocolRegistry = new ProtocolCommandRegistry()

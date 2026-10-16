import { BrowserWindow } from 'electron'
import { parseProtocolUrl } from './parser'
import { protocolRegistry } from './registry'
import { showProtocolNotification } from './notification'
import * as logger from '../../utils/logger'
import { mainT } from '../../utils/i18n'
import type {
  ParsedProtocolRequest,
  ProtocolExecutionContext,
  ProtocolExecutionResult,
  ProtocolLogLevel,
  ProtocolNotificationOptions
} from './types'

export interface ProtocolWindowProvider {
  getMainWindow: () => BrowserWindow | null
  showMainWindow: () => BrowserWindow
}

let windowProvider: ProtocolWindowProvider = {
  getMainWindow: () => {
    const wins = BrowserWindow.getAllWindows()
    return wins.length > 0 ? wins[0] : null
  },
  showMainWindow: () => {
    const wins = BrowserWindow.getAllWindows()
    const win = wins.length > 0 ? wins[0] : null
    if (win) {
      if (win.isMinimized()) win.restore()
      if (!win.isVisible()) win.show()
      win.focus()
      return win
    }
    throw new Error('No window available')
  }
}

/**
 * 设置窗口提供者（由 main/index.ts 传入以获得正确的创建与聚焦窗口逻辑）
 */
export function setProtocolWindowProvider(provider: ProtocolWindowProvider): void {
  windowProvider = provider
}

/**
 * 快速检测协议 URL 是否要求静默执行
 */
export function isProtocolSilent(rawUrl: string): boolean {
  if (!rawUrl) return false
  const parsed = parseProtocolUrl(rawUrl)
  return parsed.silent
}

/**
 * 统一处理外部传入的协议 URL (clawbench://...)
 *
 * 执行规则:
 * 1. 记录完整入参总日志；
 * 2. 解析一级命令及二级参数字典；
 * 3. 静默模式处理:
 *    - 若 silent === true: 不激活/聚焦工作台主窗口，保持后台运行，并通过托盘发出提醒；
 *    - 若 silent === false: 先呼出主窗口 (showMainWindow)，随后执行；
 * 4. 路由并调用对应命令处理器；
 * 5. 记录执行结果到总日志。
 */
export async function handleProtocolUrl(rawUrl: string): Promise<ProtocolExecutionResult> {
  const timestamp = new Date().toISOString()
  logger.info(`[Protocol] [${timestamp}] Received protocol URL: ${rawUrl}`)

  if (!rawUrl || typeof rawUrl !== 'string') {
    logger.warn('[Protocol] Empty or invalid protocol URL received')
    return { success: false, error: 'INVALID_URL' }
  }

  // 1. 解析 URL
  let parsed: ParsedProtocolRequest
  try {
    parsed = parseProtocolUrl(rawUrl)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error('[Protocol] Failed to parse protocol URL:', rawUrl, message)
    showProtocolNotification(mainT('protocol.parseFailed', message), { type: 'error' })
    return { success: false, error: 'PARSE_FAILED' }
  }

  const { action, silent, params } = parsed
  logger.info(
    `[Protocol] Parsed command: action="${action}", silent=${silent}, params=${JSON.stringify(params)}`
  )

  // 2. 查找已注册命令
  const commandConfig = protocolRegistry.find(action)
  if (!commandConfig) {
    const notFoundMsg = mainT('protocol.unknownCommand', action)
    logger.warn(`[Protocol] ${notFoundMsg}`)
    showProtocolNotification(notFoundMsg, { type: 'error' })
    return { success: false, error: 'UNKNOWN_COMMAND' }
  }

  // 计算最终的 silent 状态（若未显式指定，使用命令默认配置）
  const finalSilent = silent || (commandConfig.defaultSilent ?? false)

  // 3. 窗口调度：若非静默，主动呼出并聚焦窗口
  if (!finalSilent) {
    try {
      windowProvider.showMainWindow()
    } catch (winErr) {
      logger.warn('[Protocol] Failed to show main window before command execution:', winErr)
    }
  }

  // 4. 构造执行上下文
  const ctx: ProtocolExecutionContext = {
    request: parsed,
    params,
    silent: finalSilent,
    getMainWindow: () => windowProvider.getMainWindow(),
    showMainWindow: () => windowProvider.showMainWindow(),
    notify: (message: string, options?: ProtocolNotificationOptions) => {
      showProtocolNotification(message, options)
    },
    log: (level: ProtocolLogLevel, message: string, ...extra: unknown[]) => {
      const fullMsg = `[Protocol] ${message}`
      if (level === 'error') {
        logger.error(fullMsg, ...extra)
      } else if (level === 'warn') {
        logger.warn(fullMsg, ...extra)
      } else {
        logger.info(fullMsg, ...extra)
      }
    }
  }

  // 5. 执行命令 handler
  try {
    const result = await commandConfig.handler(ctx)
    logger.info(
      `[Protocol] Command "${action}" executed. Success: ${result.success}, message: ${result.message || result.error || 'none'}`
    )
    return result
  } catch (execErr) {
    const message = execErr instanceof Error ? execErr.message : String(execErr)
    logger.error(`[Protocol] Exception during execution of command "${action}":`, message, execErr)
    showProtocolNotification(mainT('protocol.executionError', action, message), { type: 'error' })
    return { success: false, error: message }
  }
}

export * from './types'
export * from './parser'
export * from './notification'
export * from './registry'

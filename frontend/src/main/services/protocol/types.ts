import type { BrowserWindow } from 'electron'

export type ProtocolLogLevel = 'info' | 'warn' | 'error'

export type ProtocolNotificationType = 'info' | 'error' | 'warn'

export interface ProtocolNotificationOptions {
  title?: string
  type?: ProtocolNotificationType
}

/**
 * 解析后的自定义应用协议请求
 */
export interface ParsedProtocolRequest {
  /** 原始 URL 字符串 */
  rawUrl: string
  /** 一级命令标识 (例如: 'app', 'auth', 'install') */
  action: string
  /** 是否静默执行 (true 时不 focus 窗口，只在后台执行并通过托盘提醒) */
  silent: boolean
  /** 二级参数字典，已完成常用别名归一化 */
  params: Record<string, unknown>
}

/**
 * 协议命令执行上下文
 */
export interface ProtocolExecutionContext {
  /** 解析出的请求详情 */
  request: ParsedProtocolRequest
  /** 快捷获取二级参数 */
  params: Record<string, unknown>
  /** 是否静默 */
  silent: boolean
  /** 获取主窗口 */
  getMainWindow: () => BrowserWindow | null
  /** 显示并聚焦主窗口 */
  showMainWindow: () => BrowserWindow
  /** 发送系统托盘/系统通知 */
  notify: (message: string, options?: ProtocolNotificationOptions) => void
  /** 输出带有 [Protocol] 前缀的总日志 */
  log: (level: ProtocolLogLevel, message: string, ...extra: unknown[]) => void
}

/**
 * 协议命令执行结果
 */
export interface ProtocolExecutionResult {
  success: boolean
  message?: string
  data?: unknown
  error?: string
}

/**
 * 协议命令配置（配置驱动，便于后续无限扩展新命令）
 */
export interface ProtocolCommandConfig {
  /** 一级命令名称，如 'app', 'install' */
  name: string
  /** 别名列表，例如 ['run-app', 'subapp'] */
  aliases?: string[]
  /** 命令说明 */
  description?: string
  /** 默认是否静默执行（若 URL 中未显式指定 silent 时采用） */
  defaultSilent?: boolean
  /** 执行处理器 */
  handler: (ctx: ProtocolExecutionContext) => Promise<ProtocolExecutionResult>
}

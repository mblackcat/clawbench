import type { ParsedProtocolRequest } from './types'

/** URL scheme registered by the app (see main/index.ts setAsDefaultProtocolClient). */
export const PROTOCOL_SCHEME = 'clawbench'
const PROTOCOL_PREFIX = PROTOCOL_SCHEME

/**
 * 将布尔类型值解析为 boolean
 */
export function parseBooleanFlag(val: unknown, defaultValue = false): boolean {
  if (val === undefined || val === null) return defaultValue
  if (typeof val === 'boolean') return val
  const s = String(val).trim().toLowerCase()
  if (s === 'true' || s === '1' || s === 'yes' || s === 'on' || s === '') return true
  if (s === 'false' || s === '0' || s === 'no' || s === 'off') return false
  return defaultValue
}

/**
 * 解析自定义应用协议 URL
 *
 * 格式兼容:
 * 1. Path-based:
 *    - clawbench://app?id=com.clawbench.builtin.example&silent=true&autoInstall=true
 *    - clawbench://app/com.clawbench.builtin.example?silent=true
 * 2. Query-based:
 *    - clawbench://?action=app&id=...
 *    - clawbench://run?cmd=app&id=...
 * 3. 历史兼容:
 *    - clawbench://auth/callback?...
 *    - clawbench://install/com.xxx?name=...
 */
export function parseProtocolUrl(rawUrl: string): ParsedProtocolRequest {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return {
      rawUrl: rawUrl || '',
      action: '',
      silent: false,
      params: {}
    }
  }
  let sanitizedUrl = rawUrl.trim().replace(/^["']|["']$/g, '').trim()
  if (sanitizedUrl.includes('?') && sanitizedUrl.endsWith('/')) {
    sanitizedUrl = sanitizedUrl.replace(/\/+$/, '')
  }

  // 确保具有标准 scheme 前缀供 URL 解析器处理
  if (sanitizedUrl.startsWith(`${PROTOCOL_PREFIX}:/`) && !sanitizedUrl.startsWith(`${PROTOCOL_PREFIX}://`)) {
    sanitizedUrl = sanitizedUrl.replace(`${PROTOCOL_PREFIX}:/`, `${PROTOCOL_PREFIX}:///`)
  } else if (!sanitizedUrl.includes('://')) {
    sanitizedUrl = `${PROTOCOL_PREFIX}://${sanitizedUrl}`
  }

  let urlObj: URL
  try {
    urlObj = new URL(sanitizedUrl)
  } catch {
    // 简单 fallback 解析
    return fallbackParse(rawUrl)
  }

  // 提取 searchParams
  const params: Record<string, unknown> = {}
  for (const [key, value] of urlObj.searchParams.entries()) {
    // 如果已经存在同一 key，且多次出现则转为数组或保留最新；清理末尾可能的 trailing slash
    const cleanVal = typeof value === 'string' ? value.replace(/\/+$/, '') : value
    params[key] = cleanVal
  }

  // 确定 action
  let hostPart = (urlObj.hostname || '').toLowerCase()
  const rawPath = urlObj.pathname.replace(/^\/+/, '') // 去掉前导 /
  const pathSegments = rawPath.split('/').filter(Boolean).map((s) => decodeURIComponent(s))

  let action = ''

  // 处理 clawbench://auth/callback 特殊情况
  if (hostPart === 'auth' || (hostPart === '' && pathSegments[0] === 'auth')) {
    action = 'auth'
    const isCallback = hostPart === 'auth' ? pathSegments[0] === 'callback' : pathSegments[1] === 'callback'
    if (isCallback) {
      params.subPath = 'callback'
    }
  } else if (hostPart && !['action', 'run', 'execute', 'api', 'call'].includes(hostPart)) {
    action = hostPart
  } else if (pathSegments.length > 0) {
    action = pathSegments[0].toLowerCase()
  }

  // 如果仍未确定 action，从 query 参数中提取 action / command / cmd
  if (!action || ['action', 'run', 'execute', 'api', 'call'].includes(action)) {
    if (params.action) {
      action = String(params.action).toLowerCase()
      delete params.action
    } else if (params.command && !params.id && !params.args) {
      // 避免误吞 cmd 命令中的 command 参数
      action = String(params.command).toLowerCase()
      delete params.command
    } else if (params.cmd && !params.id && !params.args) {
      action = String(params.cmd).toLowerCase()
      delete params.cmd
    }
  }

  // 检查路径中是否携带了默认标识符，例如 clawbench://app/com.clawbench.builtin.example
  if (pathSegments.length > 0) {
    if (action === hostPart) {
      // 路径中的第一个段可能是应用 ID 或子路径
      const firstSegment = pathSegments[0]
      if (firstSegment && !params.id && !params.appId) {
        params.id = firstSegment
      }
      if (pathSegments.length > 1) {
        params.subPath = pathSegments.slice(1).join('/')
      }
    } else if (pathSegments.length > 1) {
      // action 来自 pathSegments[0]
      const secondSegment = pathSegments[1]
      if (secondSegment && !params.id && !params.appId) {
        params.id = secondSegment
      }
    }
  }

  // 归一化常用参数
  normalizeParams(params)

  // 提取并解析 silent
  const silent = parseBooleanFlag(params.silent, false)
  delete params.silent

  return {
    rawUrl,
    action: action.trim().toLowerCase(),
    silent,
    params
  }
}

/**
 * 常用参数别名归一化
 */
function normalizeParams(params: Record<string, unknown>): void {
  // 1. App ID 别名归一化
  if (!params.id) {
    if (params.appId) {
      params.id = params.appId
      delete params.appId
    } else if (params.applicationId) {
      params.id = params.applicationId
      delete params.applicationId
    } else if (params.app) {
      params.id = params.app
      delete params.app
    }
  }

  // 2. autoInstall 自动安装标志归一化
  if (params.autoInstall !== undefined || params.auto_install !== undefined || params.autoinstall !== undefined) {
    const rawAuto = params.autoInstall ?? params.auto_install ?? params.autoinstall
    params.autoInstall = parseBooleanFlag(rawAuto, false)
    delete params.auto_install
    delete params.autoinstall
  } else {
    params.autoInstall = false
  }

  // 3. cmd / command 别名归一化
  if (!params.command) {
    if (params.cmd) {
      params.command = params.cmd
      delete params.cmd
    } else if (params.exec) {
      params.command = params.exec
      delete params.exec
    }
  }

  // 4. params 二级参数（若传了 JSON 字符串则解析，例如 params={"branch":"main"}）
  if (params.params && typeof params.params === 'string') {
    const trimmed = params.params.trim()
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        params.appParams = JSON.parse(trimmed)
      } catch {
        params.appParams = params.params
      }
    } else {
      params.appParams = params.params
    }
  }
}

/**
 * 降级纯正则/字符串解析器
 */
function fallbackParse(rawUrl: string): ParsedProtocolRequest {
  const queryIndex = rawUrl.indexOf('?')
  let pathPart = queryIndex !== -1 ? rawUrl.slice(0, queryIndex) : rawUrl
  const queryString = queryIndex !== -1 ? rawUrl.slice(queryIndex + 1) : ''

  pathPart = pathPart.replace(/^[^:]+:\/\//, '')
  const parts = pathPart.split('/').filter(Boolean)
  const action = parts[0] || ''

  const params: Record<string, unknown> = {}
  if (queryString) {
    for (const pair of queryString.split('&')) {
      const [k, v] = pair.split('=')
      if (k) params[decodeURIComponent(k)] = v ? decodeURIComponent(v) : ''
    }
  }

  if (parts.length > 1 && !params.id && !params.appId) {
    params.id = decodeURIComponent(parts[1])
  }

  normalizeParams(params)
  const silent = parseBooleanFlag(params.silent, false)
  delete params.silent

  return {
    rawUrl,
    action: action.toLowerCase(),
    silent,
    params
  }
}

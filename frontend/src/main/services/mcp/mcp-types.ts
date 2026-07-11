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
  /** Heuristically detected as an image-recognition tool — see `detectVisionTool()`. */
  isVisionTool?: boolean
}

const VISION_KEYWORD_RE =
  /(image|picture|photo|vision|ocr|screenshot|caption|看图|识图|读图|图片|图像|截图)/i
const IMAGE_PARAM_NAME_RE = /(image|img|picture|photo|screenshot)/i

/**
 * Best-effort detection of whether an MCP tool is an "image recognition" tool
 * (e.g. a vision MCP server like Zhipu's 读图 MCP), so it can be auto-registered
 * as a fallback for local AI models that don't natively support vision.
 *
 * Heuristic only — matches on tool name/description keywords, or an input schema
 * property that looks like an image field. May false-positive/negative; users can
 * always disable a specific MCP server if it gets mis-detected.
 */
export function detectVisionTool(tool: {
  name: string
  description?: string
  inputSchema?: Record<string, any>
}): boolean {
  const haystack = `${tool.name} ${tool.description || ''}`
  if (VISION_KEYWORD_RE.test(haystack)) return true

  const props = tool.inputSchema?.properties
  if (props && typeof props === 'object') {
    for (const [key, propSchema] of Object.entries(props as Record<string, any>)) {
      if (!IMAGE_PARAM_NAME_RE.test(key)) continue
      const type = (propSchema as any)?.type
      if (type === 'string' || (Array.isArray(type) && type.includes('string'))) {
        return true
      }
    }
  }
  return false
}

export interface ImageInputParam {
  key: string
  isArray: boolean
  /** Property name suggests raw base64 (vs. a data URI / URL string). */
  wantsBase64Only: boolean
}

/**
 * Locate the input-schema property most likely meant to carry image data, so real
 * attachment bytes can be injected into it — a model deciding to call a vision tool
 * cannot itself produce real image bytes as a tool-call argument.
 */
export function findImageInputParam(inputSchema?: Record<string, any>): ImageInputParam | undefined {
  const props = inputSchema?.properties
  if (!props || typeof props !== 'object') return undefined
  for (const [key, propSchema] of Object.entries(props as Record<string, any>)) {
    if (!IMAGE_PARAM_NAME_RE.test(key)) continue
    const type = (propSchema as any)?.type
    if (type === 'string' || (Array.isArray(type) && type.includes('string'))) {
      return { key, isArray: false, wantsBase64Only: /base64/i.test(key) }
    }
    if (type === 'array' && (propSchema as any)?.items?.type === 'string') {
      return { key, isArray: true, wantsBase64Only: /base64/i.test(key) }
    }
  }
  return undefined
}

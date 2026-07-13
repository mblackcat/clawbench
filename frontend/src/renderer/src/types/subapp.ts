export type ParamType = 'string' | 'boolean' | 'number' | 'enum' | 'path' | 'text'

export interface ParamDef {
  name: string
  type: ParamType
  label: string
  description?: string
  required?: boolean
  default?: unknown
  options?: string[] // for enum type
  options_slot?: string // optional App resolver slot for dynamic enum options
}

export interface SubAppManifest {
  id: string
  name: string
  version: string
  description: string
  author: string | { name: string; email?: string; feishu_id?: string }
  icon?: string
  type?: 'app' | 'ai-skill' | 'prompt' | 'link'
  entry: string
  url?: string // for type 'link'
  mini?: boolean // for type 'link' — render as compact 1/4-size card
  python_requirements?: string
  supported_workspace_types?: string[]
  confirm_before_run?: boolean
  params?: ParamDef[]
  min_sdk_version?: string
  published?: boolean // 是否已发布到服务端
}

/**
 * 判定本地 app 是否已发布。
 *
 * 优先级：
 * 1. manifest.published === true  → 已发布（发布成功后回写到 manifest）
 * 2. manifest.published === false → 明确未发布，以此为准（即便服务端存在同名 app，
 *    也不得覆盖本地的明确标记，避免“同名碰撞”被误标为已发布）
 * 3. manifest.published === undefined（旧版 manifest 缺少该字段）→ 回退到服务端
 *    已发布名字集合，作为跨机器 / 历史数据的兜底
 *
 * 服务端 publishedAppNames 仅在第 3 种情况下生效，绝不应盖过 manifest 中明确的
 * published:false。
 */
export function resolveAppPublished(
  manifest: Pick<SubAppManifest, 'name' | 'published'>,
  publishedAppNames: Set<string>
): boolean {
  if (manifest.published === true) return true
  if (manifest.published === false) return false
  return publishedAppNames.has(manifest.name)
}

export interface SubAppOutput {
  taskId: string
  type: 'output' | 'progress' | 'result' | 'error'
  message?: string
  content?: string
  level?: string
  percent?: number
  success?: boolean
  summary?: string
  summaryI18nKey?: string
  summaryI18nArgs?: string[]
  error?: string
  exitCode?: number | null
  data?: Record<string, unknown>
  details?: string
  i18nKey?: string
  i18nArgs?: string[]
  detailsI18nKey?: string
  detailsI18nArgs?: string[]
  timestamp?: number
}

export type TaskStatus = 'idle' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface TaskInfo {
  taskId: string
  appId: string
  appName: string
  status: TaskStatus
  progress: number
  outputs: SubAppOutput[]
  startedAt: number
  completedAt?: number
  result?: { success: boolean; summary: string; summaryI18nKey?: string; summaryI18nArgs?: string[] }
  /** True when this task was triggered by the app scheduler (定时执行), not a manual run. */
  scheduled?: boolean
}

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
 * 以服务端为准：服务端 publishedAppNames 命中即为已发布；本地的 manifest.published
 * 仅作为离线 / 本地模式下的正向兜底（发布成功后会回写为 true）。
 *
 * 注意：本地的 published 字段可能因旧版发布流程未回写而遗留为 false（脏数据），
 * 因此绝不能让本地的 false 否决服务端的命中——服务端才是唯一真相。脏数据由
 * reconcilePublishedFlags() 在加载时治愈。
 */
export function resolveAppPublished(
  manifest: Pick<SubAppManifest, 'name' | 'published'>,
  publishedAppNames: Set<string>
): boolean {
  if (publishedAppNames.has(manifest.name)) return true
  return manifest.published === true
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

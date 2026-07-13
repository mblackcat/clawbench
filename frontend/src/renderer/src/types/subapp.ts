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

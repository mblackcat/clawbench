export type ParamType = 'string' | 'boolean' | 'number' | 'enum' | 'path' | 'text'

export interface ParamDef {
  name: string
  type: ParamType
  label: string
  description?: string
  required?: boolean
  default?: unknown
  options?: string[] // for enum type
}

export interface SubAppManifest {
  id: string
  name: string
  version: string
  description: string
  author: string | { name: string; email?: string; feishu_id?: string }
  icon?: string
  type?: 'app' | 'ai-skill' | 'prompt'
  entry: string
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
  level?: string
  percent?: number
  success?: boolean
  summary?: string
  data?: Record<string, unknown>
  details?: string
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
  result?: { success: boolean; summary: string }
}

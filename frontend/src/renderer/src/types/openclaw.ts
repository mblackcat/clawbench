export type OpenClawServiceStatus = 'running' | 'stopped' | 'unknown'

export type LobsterAnimationState =
  | 'idle'
  | 'thinking'
  | 'scratching'
  | 'web_search'
  | 'doc_processing'
  | 'sending_message'
  | 'tool_call'
  | 'agent_conversation'

export interface OpenClawAgent {
  id: string
  name: string
  role: 'main' | 'sub'
  state: LobsterAnimationState
}

export interface OpenClawNode {
  id: string
  hostname: string
  isLocal: boolean
  status: OpenClawServiceStatus
  version?: string
  defaultModel?: string
  commTools: string[]
  agents: OpenClawAgent[]
}

export interface OpenClawConfigFieldOption {
  label: string
  value: string
}

export interface OpenClawConfigField {
  key: string
  label: string
  type: 'text' | 'password' | 'number' | 'select' | 'model-tags'
  placeholder?: string
  required?: boolean
  defaultValue?: string
  options?: OpenClawConfigFieldOption[]
}

export interface OpenClawItem {
  id: string
  name: string
  icon?: string
  description: string
  enabled: boolean
  category: 'ai_provider' | 'comm_tool' | 'skill' | 'builtin_feature'
  configFields: OpenClawConfigField[]
  configValues: Record<string, string>
  /** Link to the official API key / credential signup page */
  docsUrl?: string
  /** Link to the OpenClaw configuration guide for this item */
  openclawDocsUrl?: string
}

export interface OpenClawConfig {
  installPath: string
  items: OpenClawItem[]
  modelPriority: string[]
}

export interface OpenClawInstallCheck {
  installed: boolean
  version?: string
  path?: string
}

export interface CommunitySkill {
  id: string
  name: string
  description: string
  downloads: number
  installsAllTime: number
  stars: number
  author?: string
  version?: string
  category?: string
  tags?: string[]
  detailUrl?: string
}

export type CronFrequencyGroup = 'minute' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'other'

export interface CronJob {
  id: string
  name: string
  expression: string
  enabled: boolean
  /** Human-readable description of the schedule */
  description: string
  nextRun?: string
}

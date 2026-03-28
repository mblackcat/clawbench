export interface ScheduledTask {
  id: string
  name: string
  enabled: boolean
  prompt: string
  // Schedule
  repeatRule: 'none' | 'daily' | 'weekly' | 'monthly'
  time: string // "HH:mm"
  dayOfWeek?: number // 0-6 (weekly)
  dayOfMonth?: number // 1-31 (monthly)
  endDate?: string // ISO date
  // Model config
  modelSource: 'builtin' | 'local'
  modelId: string
  modelConfigId?: string
  chatMode: 'fast' | 'thinking'
  toolsEnabled: boolean
  // Behavior
  keepInOneChat: boolean
  conversationId?: string // tracked when keepInOneChat=true
  imNotifyEnabled: boolean
  // Tracking
  lastRunAt?: number
  lastRunStatus?: 'success' | 'error'
  nextRunAt?: number
  createdAt: number
  updatedAt: number
}

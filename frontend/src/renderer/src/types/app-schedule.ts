export interface AppSchedule {
  id: string
  appId: string
  appName: string
  enabled: boolean
  // Schedule
  repeatRule: 'none' | 'daily' | 'weekly' | 'monthly'
  time: string // "HH:MM"
  dayOfWeek?: number // 0-6 (weekly)
  dayOfMonth?: number // 1-31 (monthly)
  endDate?: string // ISO date
  // Execution params captured in the schedule editor (manifest.params shape)
  params: Record<string, unknown>
  // Tracking
  lastRunAt?: number
  lastRunStatus?: 'success' | 'error'
  lastRunSummary?: string
  nextRunAt?: number
  createdAt: number
  updatedAt: number
}

export interface AppScheduleInput {
  appName: string
  enabled: boolean
  repeatRule: 'none' | 'daily' | 'weekly' | 'monthly'
  time: string
  dayOfWeek?: number
  dayOfMonth?: number
  endDate?: string
  params: Record<string, unknown>
}

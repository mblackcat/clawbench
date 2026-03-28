import Store from 'electron-store'
import { randomUUID } from 'crypto'

export interface ScheduledTask {
  id: string
  name: string
  enabled: boolean
  prompt: string
  repeatRule: 'none' | 'daily' | 'weekly' | 'monthly'
  time: string
  dayOfWeek?: number
  dayOfMonth?: number
  endDate?: string
  modelSource: 'builtin' | 'local'
  modelId: string
  modelConfigId?: string
  chatMode: 'fast' | 'thinking'
  toolsEnabled: boolean
  keepInOneChat: boolean
  conversationId?: string
  imNotifyEnabled: boolean
  lastRunAt?: number
  lastRunStatus?: 'success' | 'error'
  nextRunAt?: number
  createdAt: number
  updatedAt: number
}

interface ScheduledTaskSchema {
  tasks: ScheduledTask[]
}

export const scheduledTaskStore = new Store<ScheduledTaskSchema>({
  name: 'scheduled-tasks',
  schema: {
    tasks: {
      type: 'array',
      default: [],
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          enabled: { type: 'boolean' },
          prompt: { type: 'string' },
          repeatRule: { type: 'string' },
          time: { type: 'string' },
          dayOfWeek: { type: 'number' },
          dayOfMonth: { type: 'number' },
          endDate: { type: 'string' },
          modelSource: { type: 'string' },
          modelId: { type: 'string' },
          modelConfigId: { type: 'string' },
          chatMode: { type: 'string' },
          toolsEnabled: { type: 'boolean' },
          keepInOneChat: { type: 'boolean' },
          conversationId: { type: 'string' },
          imNotifyEnabled: { type: 'boolean' },
          lastRunAt: { type: 'number' },
          lastRunStatus: { type: 'string' },
          nextRunAt: { type: 'number' },
          createdAt: { type: 'number' },
          updatedAt: { type: 'number' }
        }
      }
    }
  }
})

export function listScheduledTasks(): ScheduledTask[] {
  return scheduledTaskStore.get('tasks') || []
}

export function getScheduledTask(id: string): ScheduledTask | undefined {
  const tasks = listScheduledTasks()
  return tasks.find((t) => t.id === id)
}

export function createScheduledTask(
  data: Omit<ScheduledTask, 'id' | 'createdAt' | 'updatedAt'>
): ScheduledTask {
  const now = Date.now()
  const task: ScheduledTask = {
    ...data,
    id: randomUUID(),
    createdAt: now,
    updatedAt: now
  }
  const tasks = listScheduledTasks()
  tasks.push(task)
  scheduledTaskStore.set('tasks', tasks)
  return task
}

export function updateScheduledTask(
  id: string,
  updates: Partial<Omit<ScheduledTask, 'id' | 'createdAt'>>
): ScheduledTask | undefined {
  const tasks = listScheduledTasks()
  const idx = tasks.findIndex((t) => t.id === id)
  if (idx === -1) return undefined
  tasks[idx] = { ...tasks[idx], ...updates, updatedAt: Date.now() }
  scheduledTaskStore.set('tasks', tasks)
  return tasks[idx]
}

export function deleteScheduledTask(id: string): boolean {
  const tasks = listScheduledTasks()
  const filtered = tasks.filter((t) => t.id !== id)
  if (filtered.length === tasks.length) return false
  scheduledTaskStore.set('tasks', filtered)
  return true
}

export function setScheduledTaskEnabled(id: string, enabled: boolean): ScheduledTask | undefined {
  return updateScheduledTask(id, { enabled })
}

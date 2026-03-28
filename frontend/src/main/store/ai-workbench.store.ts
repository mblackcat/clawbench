import Store from 'electron-store'
import { randomUUID } from 'crypto'
import * as path from 'path'

export type AIToolType = 'claude' | 'codex' | 'gemini' | 'opencode' | 'qwen' | 'terminal'

export interface AIWorkbenchWorkspace {
  id: string
  title: string
  workingDir: string
  groupId: string
  createdAt: number
  updatedAt: number
}

export interface AIWorkbenchSession {
  id: string
  workspaceId: string
  toolSessionId?: string
  toolType: AIToolType
  source: 'local' | 'im'
  status: 'closed' | 'idle' | 'running' | 'completed' | 'error'
  lastActivity: 'thinking' | 'tool_call' | 'writing' | 'reading' | 'waiting_input' | 'auth_request' | 'none'
  costUsd?: number
  durationMs?: number
  startedAt?: number
  title?: string
  createdAt: number
  updatedAt: number
  // Runtime fields persisted so the workbench can re-attach after a restart
  pidFile?: string
}

export interface AIWorkbenchGroup {
  id: string
  name: string
  isDefault: boolean
  order: number
}

export interface AIWorkbenchIMConfig {
  feishu: {
    appId: string
    appSecret: string
  }
}

interface AIWorkbenchSchema {
  workspaces: AIWorkbenchWorkspace[]
  sessions: AIWorkbenchSession[]
  groups: AIWorkbenchGroup[]
  imConfig: AIWorkbenchIMConfig
  /** Whether the user wants IM to auto-connect on startup. Set true on explicit connect, false on explicit disconnect. */
  imAutoConnect: boolean
}

const DEFAULT_GROUP: AIWorkbenchGroup = {
  id: 'default',
  name: 'Default',
  isDefault: true,
  order: 0
}

const DEFAULT_IM_CONFIG: AIWorkbenchIMConfig = {
  feishu: { appId: '', appSecret: '' }
}

export const aiWorkbenchStore = new Store<AIWorkbenchSchema>({
  name: 'ai-workbench',
  schema: {
    workspaces: {
      type: 'array',
      default: [],
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          workingDir: { type: 'string' },
          groupId: { type: 'string' },
          createdAt: { type: 'number' },
          updatedAt: { type: 'number' }
        }
      }
    },
    sessions: {
      type: 'array',
      default: [],
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          workspaceId: { type: 'string' },
          toolSessionId: { type: 'string' },
          toolType: { type: 'string' },
          source: { type: 'string' },
          status: { type: 'string' },
          lastActivity: { type: 'string' },
          costUsd: { type: 'number' },
          durationMs: { type: 'number' },
          startedAt: { type: 'number' },
          createdAt: { type: 'number' },
          updatedAt: { type: 'number' },
          pidFile: { type: 'string' }
        }
      }
    },
    groups: {
      type: 'array',
      default: [DEFAULT_GROUP],
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          isDefault: { type: 'boolean' },
          order: { type: 'number' }
        }
      }
    },
    imConfig: {
      type: 'object',
      default: DEFAULT_IM_CONFIG,
      properties: {
        feishu: {
          type: 'object',
          properties: {
            appId: { type: 'string' },
            appSecret: { type: 'string' }
          }
        }
      }
    },
    imAutoConnect: {
      type: 'boolean',
      default: false
    }
  }
})

/**
 * Migrate V1 sessions (with toolType/workingDir/groupId on session) to V2
 * workspace + session pairs. Runs once on startup; is a no-op if already migrated.
 *
 * @deprecated Safe to remove after v0.4.0 — all users should have migrated by then.
 */
export function migrateV1ToV2(): void {
  const sessions = aiWorkbenchStore.get('sessions') ?? []
  const workspaces = aiWorkbenchStore.get('workspaces') ?? []

  // If workspaces already exist or sessions don't have V1 fields, skip
  if (workspaces.length > 0) return

  // Check if any session has V1 fields (toolType on session object)
  const v1Sessions = sessions.filter((s: any) => s.toolType && s.workingDir)
  if (v1Sessions.length === 0) return

  const now = Date.now()
  const newWorkspaces: AIWorkbenchWorkspace[] = []
  const newSessions: AIWorkbenchSession[] = []

  for (const old of v1Sessions as any[]) {
    const workspaceId = randomUUID()
    const lastDir = path.basename(old.workingDir) || old.workingDir

    newWorkspaces.push({
      id: workspaceId,
      title: old.title || lastDir,
      workingDir: old.workingDir,
      groupId: old.groupId || 'default',
      createdAt: old.createdAt || now,
      updatedAt: now
    })

    newSessions.push({
      id: old.id, // preserve ID for process re-attachment
      workspaceId,
      toolType: old.toolType,
      source: 'local',
      toolSessionId: undefined,
      status: old.status || 'closed',
      lastActivity: old.lastActivity || 'none',
      createdAt: old.createdAt || now,
      updatedAt: now,
      pidFile: old.pidFile
    })
  }

  aiWorkbenchStore.set('workspaces', newWorkspaces)
  aiWorkbenchStore.set('sessions', newSessions)
}

/**
 * Migrate V2 (toolType on workspace) to V3 (toolType on session).
 * Copies toolType from the parent workspace onto each session, sets source: 'local',
 * then removes toolType from workspace objects.
 *
 * @deprecated Safe to remove after v0.4.0 — all users should have migrated by then.
 */
export function migrateV2ToV3(): void {
  const workspaces = aiWorkbenchStore.get('workspaces') ?? []
  const sessions = aiWorkbenchStore.get('sessions') ?? []

  // Check if migration is needed: workspaces still have toolType field
  const needsMigration = workspaces.some((w: any) => w.toolType !== undefined)
  if (!needsMigration) return

  const now = Date.now()

  // Build workspace toolType lookup
  const wsToolTypes = new Map<string, string>()
  for (const w of workspaces as any[]) {
    if (w.toolType) {
      wsToolTypes.set(w.id, w.toolType)
    }
  }

  // Update sessions: add toolType from parent workspace, set source
  const updatedSessions = sessions.map((s: any): AIWorkbenchSession => {
    if (s.toolType && s.source) return s // already migrated
    return {
      ...s,
      toolType: s.toolType || wsToolTypes.get(s.workspaceId) || 'claude',
      source: s.source || 'local',
      updatedAt: now
    }
  })

  // Remove toolType from workspaces
  const updatedWorkspaces = workspaces.map((w: any): AIWorkbenchWorkspace => {
    const { toolType, ...rest } = w
    return { ...rest, updatedAt: now }
  })

  aiWorkbenchStore.set('workspaces', updatedWorkspaces)
  aiWorkbenchStore.set('sessions', updatedSessions)
}

export function getAIWorkbenchConfig(): AIWorkbenchSchema {
  let groups = aiWorkbenchStore.get('groups')
  if (!groups || groups.length === 0 || !groups.some((g) => g.isDefault)) {
    groups = [DEFAULT_GROUP]
    aiWorkbenchStore.set('groups', groups)
  }
  return {
    workspaces: aiWorkbenchStore.get('workspaces') ?? [],
    sessions: aiWorkbenchStore.get('sessions') ?? [],
    groups,
    imConfig: aiWorkbenchStore.get('imConfig') ?? DEFAULT_IM_CONFIG,
    imAutoConnect: aiWorkbenchStore.get('imAutoConnect') ?? false
  }
}

export function setAIWorkbenchWorkspaces(workspaces: AIWorkbenchWorkspace[]): void {
  aiWorkbenchStore.set('workspaces', workspaces)
}

export function setAIWorkbenchSessions(sessions: AIWorkbenchSession[]): void {
  aiWorkbenchStore.set('sessions', sessions)
}

export function setAIWorkbenchGroups(groups: AIWorkbenchGroup[]): void {
  aiWorkbenchStore.set('groups', groups)
}

export function setAIWorkbenchIMConfig(imConfig: AIWorkbenchIMConfig): void {
  aiWorkbenchStore.set('imConfig', imConfig)
}

export function getIMAutoConnect(): boolean {
  return aiWorkbenchStore.get('imAutoConnect') ?? false
}

export function setIMAutoConnect(value: boolean): void {
  aiWorkbenchStore.set('imAutoConnect', value)
}

import Store from 'electron-store'
import { randomUUID } from 'crypto'
import * as path from 'path'
import { migrateStoreFile } from '../utils/store-migration'

// Module renamed AI Workbench → AI Coding: carry over the old on-disk store file
// before instantiating, so existing workspaces/sessions/IM config are preserved.
migrateStoreFile('ai-workbench', 'ai-coding')

export type AIToolType = 'claude' | 'codex' | 'gemini' | 'opencode' | 'qwen' | 'terminal'

export interface AICodingWorkspace {
  id: string
  title: string
  workingDir: string
  groupId: string
  createdAt: number
  updatedAt: number
}

export interface AICodingSession {
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
  // Runtime fields persisted so AI Coding can re-attach after a restart
  pidFile?: string
}

export interface AICodingGroup {
  id: string
  name: string
  isDefault: boolean
  order: number
}

export interface AICodingIMConfig {
  feishu: {
    appId: string
    appSecret: string
  }
  /** When true, show TopBar Feishu entry and allow remote agent/coding control. Default false for new users. */
  remoteEnabled?: boolean
  /** Fixed model for IM agent mode */
  modelConfigId?: string
  modelId?: string
  /** Max agent turns per IM conversation session (default 40) */
  maxTurnsPerSession?: number
  /** Idle silence before auto-closing agent conversation (default 1h) */
  idleTimeoutMs?: number
}

interface AICodingSchema {
  workspaces: AICodingWorkspace[]
  sessions: AICodingSession[]
  groups: AICodingGroup[]
  imConfig: AICodingIMConfig
  /** Whether the user wants IM to auto-connect on startup. Set true on explicit connect, false on explicit disconnect. */
  imAutoConnect: boolean
  /** One-time soft migration for remoteEnabled */
  imRemoteMigrated?: boolean
}

const DEFAULT_GROUP: AICodingGroup = {
  id: 'default',
  name: 'Default',
  isDefault: true,
  order: 0
}

const DEFAULT_IM_CONFIG: AICodingIMConfig = {
  feishu: { appId: '', appSecret: '' },
  remoteEnabled: false,
  maxTurnsPerSession: 40,
  idleTimeoutMs: 3_600_000,
}

export const aiCodingStore = new Store<AICodingSchema>({
  name: 'ai-coding',
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
          title: { type: 'string' },
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
    },
    imRemoteMigrated: {
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
  const sessions = aiCodingStore.get('sessions') ?? []
  const workspaces = aiCodingStore.get('workspaces') ?? []

  // If workspaces already exist or sessions don't have V1 fields, skip
  if (workspaces.length > 0) return

  // Check if any session has V1 fields (toolType on session object)
  const v1Sessions = sessions.filter((s: any) => s.toolType && s.workingDir)
  if (v1Sessions.length === 0) return

  const now = Date.now()
  const newWorkspaces: AICodingWorkspace[] = []
  const newSessions: AICodingSession[] = []

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

  aiCodingStore.set('workspaces', newWorkspaces)
  aiCodingStore.set('sessions', newSessions)
}

/**
 * Migrate V2 (toolType on workspace) to V3 (toolType on session).
 * Copies toolType from the parent workspace onto each session, sets source: 'local',
 * then removes toolType from workspace objects.
 *
 * @deprecated Safe to remove after v0.4.0 — all users should have migrated by then.
 */
export function migrateV2ToV3(): void {
  const workspaces = aiCodingStore.get('workspaces') ?? []
  const sessions = aiCodingStore.get('sessions') ?? []

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
  const updatedSessions = sessions.map((s: any): AICodingSession => {
    if (s.toolType && s.source) return s // already migrated
    return {
      ...s,
      toolType: s.toolType || wsToolTypes.get(s.workspaceId) || 'claude',
      source: s.source || 'local',
      updatedAt: now
    }
  })

  // Remove toolType from workspaces
  const updatedWorkspaces = workspaces.map((w: any): AICodingWorkspace => {
    const { toolType, ...rest } = w
    return { ...rest, updatedAt: now }
  })

  aiCodingStore.set('workspaces', updatedWorkspaces)
  aiCodingStore.set('sessions', updatedSessions)
}

export function getAICodingConfig(): AICodingSchema {
  let groups = aiCodingStore.get('groups')
  if (!groups || groups.length === 0 || !groups.some((g) => g.isDefault)) {
    groups = [DEFAULT_GROUP]
    aiCodingStore.set('groups', groups)
  }
  return {
    workspaces: aiCodingStore.get('workspaces') ?? [],
    sessions: aiCodingStore.get('sessions') ?? [],
    groups,
    imConfig: aiCodingStore.get('imConfig') ?? DEFAULT_IM_CONFIG,
    imAutoConnect: aiCodingStore.get('imAutoConnect') ?? false
  }
}

export function setAICodingWorkspaces(workspaces: AICodingWorkspace[]): void {
  aiCodingStore.set('workspaces', workspaces)
}

export function setAICodingSessions(sessions: AICodingSession[]): void {
  aiCodingStore.set('sessions', sessions)
}

export function setAICodingGroups(groups: AICodingGroup[]): void {
  aiCodingStore.set('groups', groups)
}

export function setAICodingIMConfig(imConfig: AICodingIMConfig): void {
  aiCodingStore.set('imConfig', imConfig)
}

export function getIMAutoConnect(): boolean {
  return aiCodingStore.get('imAutoConnect') ?? false
}

export function setIMAutoConnect(value: boolean): void {
  aiCodingStore.set('imAutoConnect', value)
}

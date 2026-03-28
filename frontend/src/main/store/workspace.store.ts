import Store from 'electron-store'
import { randomUUID } from 'crypto'

export interface Workspace {
  id: string
  name: string
  path: string
  vcsType: string
  createdAt: string
}

interface WorkspaceSchema {
  workspaces: Workspace[]
  activeWorkspaceId: string
}

export const workspaceStore = new Store<WorkspaceSchema>({
  name: 'workspaces',
  schema: {
    workspaces: {
      type: 'array',
      default: [],
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          path: { type: 'string' },
          vcsType: { type: 'string' },
          createdAt: { type: 'string' }
        },
        required: ['id', 'name', 'path', 'vcsType', 'createdAt']
      }
    },
    activeWorkspaceId: {
      type: 'string',
      default: ''
    }
  }
})

export function getAllWorkspaces(): Workspace[] {
  return workspaceStore.get('workspaces')
}

export function getWorkspaceById(id: string): Workspace | undefined {
  const workspaces = getAllWorkspaces()
  return workspaces.find((w) => w.id === id)
}

export function addWorkspace(workspace: Omit<Workspace, 'id' | 'createdAt'>): Workspace {
  const workspaces = getAllWorkspaces()
  const newWorkspace: Workspace = {
    ...workspace,
    id: randomUUID(),
    createdAt: new Date().toISOString()
  }
  workspaces.push(newWorkspace)
  workspaceStore.set('workspaces', workspaces)
  return newWorkspace
}

export function updateWorkspaceInStore(
  id: string,
  updates: Partial<Omit<Workspace, 'id' | 'createdAt'>>
): Workspace | undefined {
  const workspaces = getAllWorkspaces()
  const index = workspaces.findIndex((w) => w.id === id)
  if (index === -1) return undefined
  workspaces[index] = { ...workspaces[index], ...updates }
  workspaceStore.set('workspaces', workspaces)
  return workspaces[index]
}

export function removeWorkspace(id: string): boolean {
  const workspaces = getAllWorkspaces()
  const filtered = workspaces.filter((w) => w.id !== id)
  if (filtered.length === workspaces.length) return false
  workspaceStore.set('workspaces', filtered)

  // Clear active workspace if it was the deleted one
  if (workspaceStore.get('activeWorkspaceId') === id) {
    workspaceStore.set('activeWorkspaceId', '')
  }
  return true
}

export function getActiveWorkspaceId(): string {
  return workspaceStore.get('activeWorkspaceId')
}

export function setActiveWorkspaceId(id: string): void {
  workspaceStore.set('activeWorkspaceId', id)
}

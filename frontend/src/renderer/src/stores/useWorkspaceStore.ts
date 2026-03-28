import { create } from 'zustand'
import type { Workspace } from '../types/workspace'

interface WorkspaceState {
  workspaces: Workspace[]
  activeWorkspace: Workspace | null
  loading: boolean
  fetchWorkspaces: () => Promise<void>
  createWorkspace: (name: string, path: string, vcsType?: string) => Promise<Workspace>
  deleteWorkspace: (id: string) => Promise<void>
  setActiveWorkspace: (id: string) => Promise<void>
  updateWorkspace: (id: string, updates: Partial<Workspace>) => Promise<void>
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  workspaces: [],
  activeWorkspace: null,
  loading: false,

  fetchWorkspaces: async () => {
    set({ loading: true })
    try {
      const [workspaces, activeWorkspace] = await Promise.all([
        window.api.workspace.list(),
        window.api.workspace.getActive()
      ])
      set({ workspaces, activeWorkspace })
    } finally {
      set({ loading: false })
    }
  },

  createWorkspace: async (name: string, path: string, vcsType?: string) => {
    const workspace = await window.api.workspace.create(name, path, vcsType)
    const shouldActivate = useWorkspaceStore.getState().activeWorkspace === null
    if (shouldActivate) {
      await window.api.workspace.setActive(workspace.id)
      set((state) => ({
        workspaces: [...state.workspaces, workspace],
        activeWorkspace: workspace
      }))
    } else {
      set((state) => ({ workspaces: [...state.workspaces, workspace] }))
    }
    return workspace
  },

  deleteWorkspace: async (id: string) => {
    await window.api.workspace.delete(id)
    set((state) => ({
      workspaces: state.workspaces.filter((w) => w.id !== id),
      activeWorkspace: state.activeWorkspace?.id === id ? null : state.activeWorkspace
    }))
  },

  setActiveWorkspace: async (id: string) => {
    await window.api.workspace.setActive(id)
    set((state) => ({
      activeWorkspace: state.workspaces.find((w) => w.id === id) ?? null
    }))
  },

  updateWorkspace: async (id: string, updates: Partial<Workspace>) => {
    await window.api.workspace.update(id, updates)
    set((state) => ({
      workspaces: state.workspaces.map((w) => (w.id === id ? { ...w, ...updates } : w)),
      activeWorkspace:
        state.activeWorkspace?.id === id
          ? { ...state.activeWorkspace, ...updates }
          : state.activeWorkspace
    }))
  }
}))

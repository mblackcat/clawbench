import { create } from 'zustand'
import type { ScannedSkill, SkillSource, SkillTool, SkillInstallMode } from '../types/skill'

interface SkillState {
  /** Skills loaded from disk via drag-in / picker (reference only). */
  localSources: SkillSource[]
  /** Skills found in the user's global AI-tool dirs (~/.claude/skills, ...). */
  globalSkills: ScannedSkill[]
  /** Skills found in the active workspace project's AI-tool dirs. */
  projectSkills: ScannedSkill[]
  loading: boolean

  fetchLocalSources: () => Promise<void>
  fetchGlobalSkills: (tools?: SkillTool[]) => Promise<void>
  fetchProjectSkills: (workspacePath: string | undefined, tools?: SkillTool[]) => Promise<void>
  fetchAll: (workspacePath: string | undefined) => Promise<void>

  loadLocal: (inputPath: string) => Promise<{ success: boolean; error?: string }>
  removeLocalSource: (id: string) => Promise<void>
  install: (opts: {
    sourceDir: string
    mode: SkillInstallMode
    tools: SkillTool[]
    workspacePath?: string
    skillId?: string
  }) => Promise<{ success: boolean; installedTo: string[]; error?: string }>
}

export const useSkillStore = create<SkillState>((set, get) => ({
  localSources: [],
  globalSkills: [],
  projectSkills: [],
  loading: false,

  fetchLocalSources: async () => {
    const res = await window.api.skill.listLocalSources()
    if (res.success) set({ localSources: res.sources })
  },

  fetchGlobalSkills: async (tools) => {
    const res = await window.api.skill.scanGlobal(tools)
    if (res.success) set({ globalSkills: res.skills })
  },

  fetchProjectSkills: async (workspacePath, tools) => {
    if (!workspacePath) {
      set({ projectSkills: [] })
      return
    }
    const res = await window.api.skill.scanProject(workspacePath, tools)
    if (res.success) set({ projectSkills: res.skills })
  },

  fetchAll: async (workspacePath) => {
    set({ loading: true })
    try {
      await Promise.all([
        get().fetchLocalSources(),
        get().fetchGlobalSkills(),
        get().fetchProjectSkills(workspacePath)
      ])
    } finally {
      set({ loading: false })
    }
  },

  loadLocal: async (inputPath: string) => {
    const res = await window.api.skill.loadLocal(inputPath)
    if (res.success) {
      await get().fetchLocalSources()
    }
    return { success: res.success, error: res.error }
  },

  removeLocalSource: async (id: string) => {
    await window.api.skill.removeLocalSource(id)
    set((state) => ({ localSources: state.localSources.filter((s) => s.id !== id) }))
  },

  install: async (opts) => {
    return window.api.skill.install(opts)
  }
}))

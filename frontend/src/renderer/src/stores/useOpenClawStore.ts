import { create } from 'zustand'
import type {
  OpenClawInstallCheck,
  OpenClawServiceStatus,
  OpenClawItem,
  CommunitySkill,
  CronJob,
  LobsterAnimationState,
  OpenClawNode
} from '../types/openclaw'

const BUILTIN_PROVIDER_IDS = new Set(['openai', 'anthropic', 'google'])

function getItemModelIds(item: OpenClawItem): string[] {
  if (!item.configValues.models) return []
  return item.configValues.models
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean)
    .map((m) => (BUILTIN_PROVIDER_IDS.has(item.id) ? m : `${item.id}/${m}`))
}

function syncPriority(current: string[], items: OpenClawItem[]): string[] {
  const all = new Set<string>()
  for (const item of items) {
    if (item.category === 'ai_provider' && item.enabled) {
      for (const id of getItemModelIds(item)) all.add(id)
    }
  }
  // Only remove models that are no longer available; don't auto-add new ones
  return current.filter((m) => all.has(m))
}

interface OpenClawState {
  installCheck: OpenClawInstallCheck | null
  serviceStatus: OpenClawServiceStatus
  items: OpenClawItem[]
  modelPriority: string[]
  configLoading: boolean
  dirty: boolean
  saving: boolean
  applying: boolean
  installing: boolean
  uninstalling: boolean
  communitySkills: CommunitySkill[]
  installedSkillIds: string[]
  skillsLoading: boolean
  cronJobs: CronJob[]
  cronLoading: boolean
  latestVersion: string | null
  checkingUpdate: boolean
  upgrading: boolean
  activityState: LobsterAnimationState
  activeSubagents: Array<{ id: string; label: string; model?: string }>
  nodes: OpenClawNode[]

  checkInstalled: () => Promise<void>
  installOpenClaw: () => Promise<{ success: boolean; error?: string }>
  uninstallOpenClaw: (removeConfig: boolean) => Promise<{ success: boolean; error?: string }>
  fetchStatus: () => Promise<void>
  fetchConfig: () => Promise<void>
  updateItemEnabled: (id: string, enabled: boolean) => void
  updateItemConfigValue: (id: string, key: string, value: string) => void
  updateModelPriority: (priority: string[]) => void
  saveConfig: () => Promise<void>
  applyConfig: () => Promise<{ success: boolean; error?: string }>
  startService: () => Promise<{ success: boolean; error?: string }>
  stopService: () => Promise<{ success: boolean; error?: string }>
  fetchCommunitySkills: () => Promise<void>
  installSkill: (id: string) => Promise<{ success: boolean; output: string }>
  fetchCronJobs: () => Promise<void>
  toggleCronJob: (id: string, enabled: boolean) => Promise<void>
  checkUpdate: () => Promise<void>
  upgradeOpenClaw: () => Promise<{ success: boolean; error?: string }>
  pairingApprove: (channel: string, code: string) => Promise<{ success: boolean; error?: string }>
  startGoogleOAuth: () => Promise<{ success: boolean; url?: string; error?: string }>
  setActivityState: (state: LobsterAnimationState) => void
  buildNodes: () => void
  subscribeActivityState: () => () => void
}

export const useOpenClawStore = create<OpenClawState>((set, get) => ({
  installCheck: null,
  serviceStatus: 'unknown',
  items: [],
  modelPriority: [],
  configLoading: false,
  dirty: false,
  saving: false,
  applying: false,
  installing: false,
  uninstalling: false,
  communitySkills: [],
  installedSkillIds: [],
  skillsLoading: false,
  cronJobs: [],
  cronLoading: false,
  latestVersion: null,
  checkingUpdate: false,
  upgrading: false,
  activityState: 'idle' as LobsterAnimationState,
  activeSubagents: [] as Array<{ id: string; label: string; model?: string }>,
  nodes: [] as OpenClawNode[],

  checkInstalled: async () => {
    try {
      const result = await window.api.openclaw.checkInstalled()
      set({ installCheck: result })
    } catch (err) {
      console.error('Failed to check openclaw installation:', err)
      set({ installCheck: { installed: false } })
    }
  },

  installOpenClaw: async () => {
    set({ installing: true })
    try {
      const result = await window.api.openclaw.install()
      if (result.success) {
        const check = await window.api.openclaw.checkInstalled()
        set({ installCheck: check, installing: false })
        return { success: true }
      }
      set({ installing: false })
      return { success: false, error: result.error || '安装失败' }
    } catch (err: any) {
      console.error('Failed to install openclaw:', err)
      set({ installing: false })
      return { success: false, error: err.message || '安装过程中发生异常' }
    }
  },

  uninstallOpenClaw: async (removeConfig: boolean) => {
    set({ uninstalling: true })
    try {
      const result = await window.api.openclaw.uninstall(removeConfig)
      if (result.success) {
        set({
          installCheck: { installed: false },
          serviceStatus: 'stopped',
          items: [],
          dirty: false,
          uninstalling: false
        })
      } else {
        set({ uninstalling: false })
      }
      return result
    } catch (err: any) {
      console.error('Failed to uninstall openclaw:', err)
      set({ uninstalling: false })
      return { success: false, error: err.message }
    }
  },

  fetchStatus: async () => {
    try {
      const status = await window.api.openclaw.getStatus()
      set({ serviceStatus: status })
    } catch (err) {
      console.error('Failed to fetch openclaw status:', err)
      set({ serviceStatus: 'unknown' })
    }
  },

  fetchConfig: async () => {
    set({ configLoading: true })
    try {
      const config = await window.api.openclaw.getConfig()
      set({ items: config.items, modelPriority: config.modelPriority, configLoading: false, dirty: false })
    } catch (err) {
      console.error('Failed to fetch openclaw config:', err)
      set({ configLoading: false })
    }
  },

  updateItemEnabled: (id: string, enabled: boolean) => {
    const items = get().items.map((item) =>
      item.id === id ? { ...item, enabled } : item
    )
    set({ items, modelPriority: syncPriority(get().modelPriority, items), dirty: true })
  },

  updateItemConfigValue: (id: string, key: string, value: string) => {
    const items = get().items.map((item) =>
      item.id === id
        ? { ...item, configValues: { ...item.configValues, [key]: value } }
        : item
    )
    // Re-sync priority only when the models field changes on an enabled provider
    const changedItem = items.find((i) => i.id === id)
    const needsSync = key === 'models' && changedItem?.category === 'ai_provider' && changedItem?.enabled
    set({ items, modelPriority: needsSync ? syncPriority(get().modelPriority, items) : get().modelPriority, dirty: true })
  },

  updateModelPriority: (priority: string[]) => {
    set({ modelPriority: priority, dirty: true })
  },

  saveConfig: async () => {
    set({ saving: true })
    try {
      await window.api.openclaw.saveConfig({ items: get().items, modelPriority: get().modelPriority })
      set({ saving: false, dirty: false })
    } catch (err) {
      console.error('Failed to save openclaw config:', err)
      set({ saving: false })
    }
  },

  applyConfig: async () => {
    set({ applying: true })
    try {
      const result = await window.api.openclaw.applyConfig({ items: get().items, modelPriority: get().modelPriority })
      set({ applying: false, dirty: false })
      if (result.success) {
        set({ serviceStatus: 'running' })
      }
      return result
    } catch (err: any) {
      console.error('Failed to apply openclaw config:', err)
      set({ applying: false })
      return { success: false, error: err.message }
    }
  },

  startService: async () => {
    try {
      const result = await window.api.openclaw.start()
      if (result.success) {
        set({ serviceStatus: 'running' })
      }
      return result
    } catch (err: any) {
      console.error('Failed to start openclaw:', err)
      return { success: false, error: err.message }
    }
  },

  stopService: async () => {
    try {
      const result = await window.api.openclaw.stop()
      if (result.success) {
        set({ serviceStatus: 'stopped' })
      }
      return result
    } catch (err: any) {
      console.error('Failed to stop openclaw:', err)
      return { success: false, error: err.message }
    }
  },

  fetchCommunitySkills: async () => {
    set({ skillsLoading: true })
    try {
      const skills = await window.api.openclaw.listCommunitySkills()
      set({ communitySkills: skills, skillsLoading: false })
    } catch (err) {
      console.error('Failed to fetch community skills:', err)
      set({ skillsLoading: false })
    }
  },

  installSkill: async (id: string) => {
    try {
      const result = await window.api.openclaw.installSkill(id)
      if (result.success) {
        const ids = get().installedSkillIds
        if (!ids.includes(id)) {
          set({ installedSkillIds: [...ids, id] })
        }
      }
      return result
    } catch (err: any) {
      console.error('Failed to install skill:', err)
      return { success: false, output: err.message }
    }
  },

  fetchCronJobs: async () => {
    set({ cronLoading: true })
    try {
      const jobs = await window.api.openclaw.getCronJobs()
      set({ cronJobs: jobs, cronLoading: false })
    } catch (err) {
      console.error('Failed to fetch cron jobs:', err)
      set({ cronLoading: false })
    }
  },

  toggleCronJob: async (id: string, enabled: boolean) => {
    try {
      await window.api.openclaw.toggleCronJob(id, enabled)
      set((state) => ({
        cronJobs: state.cronJobs.map((job) =>
          job.id === id ? { ...job, enabled } : job
        )
      }))
    } catch (err) {
      console.error('Failed to toggle cron job:', err)
    }
  },

  checkUpdate: async () => {
    set({ checkingUpdate: true })
    try {
      const { latestVersion } = await window.api.openclaw.checkLatestVersion()
      set({ latestVersion, checkingUpdate: false })
    } catch {
      set({ checkingUpdate: false })
    }
  },

  upgradeOpenClaw: async () => {
    set({ upgrading: true })
    try {
      const result = await window.api.openclaw.install()
      if (result.success) {
        const check = await window.api.openclaw.checkInstalled()
        set({ installCheck: check, latestVersion: null, upgrading: false })
        return { success: true }
      }
      set({ upgrading: false })
      return { success: false, error: result.error || '升级失败' }
    } catch (err: any) {
      set({ upgrading: false })
      return { success: false, error: err.message || '升级过程中发生异常' }
    }
  },

  pairingApprove: async (channel: string, code: string) => {
    try {
      return await window.api.openclaw.pairingApprove(channel, code)
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  },

  startGoogleOAuth: async () => {
    try {
      const result = await window.api.openclaw.startGoogleOAuth()
      if (result.success) {
        // Re-fetch config to pick up updated auth.profiles (oauthEmail etc.)
        const config = await window.api.openclaw.getConfig()
        set({ items: config.items, modelPriority: config.modelPriority })
      }
      return result
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  },

  setActivityState: (state: LobsterAnimationState) => {
    set({ activityState: state })
  },

  buildNodes: () => {
    const { installCheck, serviceStatus, items, modelPriority, activityState, activeSubagents } = get()
    if (!installCheck?.installed) {
      set({ nodes: [] })
      return
    }

    const activeCommTools = items
      .filter((i) => i.category === 'comm_tool' && i.enabled)
      .map((i) => i.name)

    const defaultModel = modelPriority.length > 0 ? modelPriority[0] : undefined

    const localNode: OpenClawNode = {
      id: 'local',
      hostname: '本机',
      isLocal: true,
      status: serviceStatus,
      version: installCheck.version,
      defaultModel,
      commTools: activeCommTools,
      agents: [
        { id: 'main', name: 'OpenClaw', role: 'main', state: activityState },
        ...activeSubagents.map((sub) => ({
          id: sub.id,
          name: sub.label,
          role: 'sub' as const,
          // Identity-fallback sub-agents are idle unless main is actively delegating;
          // runs.json active sub-agents are always thinking (they're running)
          state: (
            sub.id === 'identity-subagent'
              ? activityState === 'agent_conversation' ? 'thinking' : 'idle'
              : 'thinking'
          ) as LobsterAnimationState
        }))
      ]
    }

    set({ nodes: [localNode] })
  },

  subscribeActivityState: () => {
    window.api.openclaw.startLogWatcher()
    const unsubActivity = window.api.openclaw.onActivityState((state: string) => {
      get().setActivityState(state as LobsterAnimationState)
      get().buildNodes()
    })
    const unsubSubagents = window.api.openclaw.onActiveSubagents((subagents) => {
      set({ activeSubagents: subagents })
      get().buildNodes()
    })
    return () => {
      unsubActivity()
      unsubSubagents()
      window.api.openclaw.stopLogWatcher()
    }
  }
}))

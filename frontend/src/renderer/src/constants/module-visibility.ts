export interface ModuleVisibility {
  aiChat: boolean
  aiCoding: boolean
  aiTerminal: boolean
  aiAgents: boolean
  localEnv: boolean
  copiper: boolean
}

export interface ModuleCardConfig {
  key: keyof ModuleVisibility
  titleKey: string
  descKey: string
}

export const DEFAULT_MODULE_VISIBILITY: ModuleVisibility = {
  aiChat: true,
  aiCoding: true,
  aiTerminal: true,
  aiAgents: true,
  localEnv: true,
  copiper: false
}

export const SETTINGS_MODULE_CARDS: ModuleCardConfig[] = [
  { key: 'aiChat', titleKey: 'modules.aiChat', descKey: 'settings.moduleDescAiChat' },
  { key: 'aiCoding', titleKey: 'modules.aiCoding', descKey: 'settings.moduleDescAiCoding' },
  { key: 'aiTerminal', titleKey: 'modules.aiTerminal', descKey: 'settings.moduleDescAiTerminal' },
  { key: 'aiAgents', titleKey: 'modules.aiAgents', descKey: 'settings.moduleDescAiAgents' },
  { key: 'localEnv', titleKey: 'modules.localEnv', descKey: 'settings.moduleDescLocalEnv' },
  { key: 'copiper', titleKey: 'modules.copiper', descKey: 'settings.moduleDescCopiper' }
]

export function normalizeModuleVisibility(value: unknown): ModuleVisibility {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_MODULE_VISIBILITY }
  }

  // Only accept boolean values for known keys; anything else (null, strings,
  // unknown keys from older/newer builds) falls back to the default.
  const raw = value as Record<string, unknown>
  const result: ModuleVisibility = { ...DEFAULT_MODULE_VISIBILITY }
  for (const key of Object.keys(DEFAULT_MODULE_VISIBILITY) as Array<keyof ModuleVisibility>) {
    const v = raw[key]
    if (typeof v === 'boolean') {
      result[key] = v
    }
  }
  return result
}

/** Role-based module visibility templates for the setup wizard */
export type SetupRole = 'general' | 'design' | 'tech' | 'art'

export const ROLE_MODULE_TEMPLATES: Record<SetupRole, ModuleVisibility> = {
  general: {
    aiChat: true,
    aiCoding: false,
    aiTerminal: false,
    aiAgents: false,
    localEnv: false,
    copiper: false
  },
  design: {
    aiChat: true,
    aiCoding: false,
    aiTerminal: false,
    aiAgents: false,
    localEnv: false,
    copiper: true
  },
  tech: {
    aiChat: true,
    aiCoding: true,
    aiTerminal: true,
    aiAgents: false,
    localEnv: true,
    copiper: false
  },
  art: {
    aiChat: true,
    aiCoding: false,
    aiTerminal: false,
    aiAgents: false,
    localEnv: false,
    copiper: false
  }
}

export const ROLE_LABELS: Record<SetupRole, string> = {
  general: '通用',
  design: '设计',
  tech: '技术',
  art: '艺术'
}

export const ROLE_LABELS_EN: Record<SetupRole, string> = {
  general: 'General',
  design: 'Design',
  tech: 'Tech',
  art: 'Art'
}

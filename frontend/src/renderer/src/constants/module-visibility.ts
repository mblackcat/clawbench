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
    return DEFAULT_MODULE_VISIBILITY
  }

  return {
    ...DEFAULT_MODULE_VISIBILITY,
    ...(value as Partial<ModuleVisibility>)
  }
}

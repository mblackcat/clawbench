import React from 'react'
import { ProviderIcon } from '../../components/ProviderIcons'
import type { AIToolType } from '../../types/ai-coding'

/**
 * Coding tools whose native CLI session history can be listed in the sidebar / tab history.
 * Keep in sync with providers registered in main/services/native-sessions.service.ts.
 */
export const TOOLS_WITH_NATIVE_SESSIONS: AIToolType[] = [
  'claude',
  'codex',
  'gemini',
  'grok',
  'opencode',
  'qoder',
  'kimi',
  'zcode',
  'trae',
  'mimo'
]

/** Soft preset colors — dark mode chips are further toned in theme-overhaul.css */
export const AI_TOOL_TAG_COLORS: Partial<Record<AIToolType, string>> = {
  claude: 'purple',
  codex: 'green',
  gemini: 'blue',
  grok: 'default',
  opencode: 'default',
  trae: 'cyan',
  qoder: 'gold',
  kimi: 'blue',
  zcode: 'geekblue',
  mimo: 'orange',
  terminal: 'default',
  qwen: 'gold'
}

export const AI_TOOL_NAMES: Record<AIToolType, string> = {
  claude: 'Claude',
  codex: 'Codex',
  gemini: 'Gemini',
  grok: 'Grok',
  opencode: 'OpenCode',
  trae: 'Trae CLI',
  qoder: 'Qoder CLI',
  kimi: 'Kimi Code',
  zcode: 'ZCode',
  mimo: 'MiMo Code',
  terminal: 'Terminal',
  qwen: 'Qwen Code'
}

export const AI_TOOL_SHORT_NAMES: Record<AIToolType, string> = {
  claude: 'Claude',
  codex: 'Codex',
  gemini: 'Gemini',
  grok: 'Grok',
  opencode: 'OpenCode',
  trae: 'Trae',
  qoder: 'Qoder',
  kimi: 'Kimi',
  zcode: 'ZCode',
  mimo: 'MiMo',
  terminal: 'Term',
  qwen: 'Qwen'
}

export const AI_TOOL_TAG_STYLE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  paddingBlock: 2
}

const AI_TOOL_ICON_PROVIDERS: Partial<Record<AIToolType, string | null>> = {
  claude: 'claude',
  codex: 'openai',
  gemini: 'google',
  grok: 'grok',
  opencode: 'opencode',
  trae: 'trae',
  qoder: 'qoder',
  kimi: 'kimi',
  zcode: 'zhipu',
  mimo: 'mimo',
  terminal: null,
  qwen: 'qwen'
}

export function getAIToolIcon(toolType: AIToolType, size = 12): React.ReactNode {
  const provider = AI_TOOL_ICON_PROVIDERS[toolType]
  if (provider === null || provider === undefined) return undefined
  return <ProviderIcon provider={provider} size={size} />
}

export function renderAIToolTagLabel(toolType: AIToolType, label: string, size = 12): React.ReactNode {
  const icon = getAIToolIcon(toolType, size)
  if (!icon) return label

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, lineHeight: 1.1 }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0 }}>
        {icon}
      </span>
      <span style={{ lineHeight: 1.1 }}>
        {label}
      </span>
    </span>
  )
}

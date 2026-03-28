import React from 'react'
import { ProviderIcon } from '../../components/ProviderIcons'
import type { AIToolType } from '../../types/ai-workbench'

export const AI_TOOL_TAG_COLORS: Partial<Record<AIToolType, string>> = {
  claude: 'purple',
  codex: 'green',
  gemini: 'blue',
  opencode: 'default',
  qwen: 'gold',
  terminal: 'default'
}

export const AI_TOOL_NAMES: Record<AIToolType, string> = {
  claude: 'Claude',
  codex: 'Codex',
  gemini: 'Gemini',
  opencode: 'OpenCode',
  qwen: 'Qwen Code',
  terminal: 'Terminal'
}

export const AI_TOOL_SHORT_NAMES: Record<AIToolType, string> = {
  claude: 'Claude',
  codex: 'Codex',
  gemini: 'Gemini',
  opencode: 'OpenCode',
  qwen: 'Qwen',
  terminal: 'Term'
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
  opencode: '',
  qwen: 'qwen',
  terminal: null
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

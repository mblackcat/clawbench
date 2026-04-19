import React from 'react'
import type { AgentConfigField } from '../../components/AgentConfigFields'
import AgentConfigFields from '../../components/AgentConfigFields'
import AgentConfigCard from '../../components/AgentConfigCard'

export type HermesModuleField = AgentConfigField

interface HermesModuleCardProps {
  icon: React.ReactNode
  iconColor?: string
  title: string
  description?: string
  note?: string
  enabled?: boolean
  onToggle?: (v: boolean) => void
  onExpandChange?: (expanded: boolean) => void
  fields?: HermesModuleField[]
  alwaysExpanded?: boolean
  readOnly?: boolean
  badge?: string
  summary?: string
  extraActions?: React.ReactNode
}

const HermesModuleCard: React.FC<HermesModuleCardProps> = ({
  icon,
  iconColor,
  title,
  description,
  note,
  enabled,
  onToggle,
  onExpandChange,
  fields = [],
  alwaysExpanded = false,
  readOnly = false,
  badge,
  summary,
  extraActions,
}) => {
  return (
    <AgentConfigCard
      icon={icon}
      iconBackground={iconColor}
      title={title}
      description={description}
      footerNote={note}
      enabled={enabled}
      onToggle={onToggle}
      onExpandChange={onExpandChange}
      alwaysExpanded={alwaysExpanded}
      readOnly={readOnly}
      badge={badge}
      summary={summary}
      actions={extraActions}
      fields={<AgentConfigFields fields={fields} />}
    />
  )
}

export default HermesModuleCard

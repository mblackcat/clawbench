import React from 'react'
import type { CustomIconComponentProps } from '@ant-design/icons/lib/components/Icon'
import type { IconInput } from 'morphicons/react'
import {
  LayoutGrid,
  Boxes,
  CodeXml,
  Sparkles,
  Terminal,
  SquareTerminal,
  Server,
  Cpu,
  FileText,
  ScrollText,
  MessageSquare,
  Bot,
  Sheet,
  FileSpreadsheet
} from 'lucide'
import { InteractiveMorphIcon } from '../common/InteractiveMorphIcon'

type MenuIconProps = Partial<CustomIconComponentProps> & {
  /** Selected state (current route) — shows the active glyph */
  active?: boolean
  /** Controlled hover state (defaults to hover detection on the parent menu item) */
  hovered?: boolean
}

/**
 * Main sidebar menu icons — lucide glyphs that morph (morphicons) into their
 * hover / active glyph with spring physics. Monochrome via currentColor, and
 * static when the motion switch is off (see common/InteractiveMorphIcon).
 */
const makeMenuIcon = (icon: IconInput, morphTo: IconInput): React.FC<MenuIconProps> => {
  const MenuIcon: React.FC<MenuIconProps> = ({ active, hovered, className, style }) => (
    <InteractiveMorphIcon
      icon={icon}
      hoverIcon={morphTo}
      activeIcon={morphTo}
      active={active}
      hovered={hovered}
      size={style?.fontSize !== undefined ? undefined : 16}
      spring="bouncy"
      className={className}
      style={style}
    />
  )
  return MenuIcon
}

/** Workbench: LayoutGrid ⇄ Boxes */
export const WorkbenchIcon = makeMenuIcon(LayoutGrid, Boxes)
/** AI Chat: MessageSquare ⇄ Bot */
export const AIChatIcon = makeMenuIcon(MessageSquare, Bot)
/** AI Work / Coding: CodeXml ⇄ Sparkles */
export const AICodingIcon = makeMenuIcon(CodeXml, Sparkles)
/** Alias matching the user-facing name "AI Work" */
export const AIWorkIcon = AICodingIcon
/** CoPiper: Sheet ⇄ FileSpreadsheet (OSS-only module) */
export const CopiperIcon = makeMenuIcon(Sheet, FileSpreadsheet)
/** AI Terminal: Terminal ⇄ SquareTerminal */
export const AITerminalIcon = makeMenuIcon(Terminal, SquareTerminal)
/** Local Env: Server ⇄ Cpu */
export const LocalEnvIcon = makeMenuIcon(Server, Cpu)
/** Logs: FileText ⇄ ScrollText */
export const LogsIcon = makeMenuIcon(FileText, ScrollText)

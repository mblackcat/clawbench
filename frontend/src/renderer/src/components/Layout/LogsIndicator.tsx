/**
 * Logs entry indicator shared by the sidebar logs button (Dev mode) and the
 * TopBar logs button (General mode, no sider).
 *
 * Absorbs the former StatusBar log icon + notification bell badge:
 *   - count  = unread legacy notifications
 *   - alert  = unseen task errors / transient error alert / notifications
 *   - dot    = alert (or unread system logs) without a count
 *
 * Attention items (background completions, AI Work sessions waiting on the user)
 * are NOT counted here: the logs drawer cannot clear them, so the badge would
 * stick. They are surfaced on their own sidebar entries and in the tray instead.
 */
import React from 'react'
import { Badge, theme } from 'antd'
import { AlertCircle, AlertTriangle } from 'lucide'
import { InteractiveMorphIcon } from '../common/InteractiveMorphIcon'
import { useTaskStore } from '../../stores/useTaskStore'
import { useNotificationStore } from '../../stores/useNotificationStore'
import { useAttentionStore } from '../../stores/useAttentionStore'
import { LogsIcon } from '../icons/MenuIcons'

export interface LogsIndicatorState {
  /** Numeric badge (0 = none) */
  badgeCount: number
  /** Something needs the user's attention (errors / notifications) */
  hasAlert: boolean
  /** Show a dot instead of a count */
  showDot: boolean
  /** An attention item requires an action (flash the icon) */
  attentionHasAction: boolean
  /** Task errors (unseen or transient alert) */
  hasErrors: boolean
}

export function useLogsIndicator(): LogsIndicatorState {
  const hasUnseenErrors = useTaskStore((s) => s.hasUnseenErrors)
  const hasErrorAlert = useTaskStore((s) => s.hasErrorAlert)
  const hasUnreadLogs = useTaskStore((s) => s.hasUnreadLogs)
  const unreadCount = useNotificationStore((s) => s.unreadCount)
  // Inline so Zustand tracks item/context changes via selector return value
  const attentionHasAction = useAttentionStore((s) => s.hasAction())

  const hasErrors = hasUnseenErrors || hasErrorAlert
  const badgeCount = unreadCount
  const hasAlert = hasErrors || unreadCount > 0
  const showDot = (hasAlert || hasUnreadLogs) && badgeCount === 0

  return { badgeCount, hasAlert, showDot, attentionHasAction, hasErrors }
}

interface LogsBadgeIconProps {
  state: LogsIndicatorState
  size?: number
  offset?: [number, number]
}

/** Logs icon wrapped in the merged badge. */
export const LogsBadgeIcon: React.FC<LogsBadgeIconProps> = ({ state, size = 16, offset = [-2, 2] }) => {
  const { token } = theme.useToken()
  const { badgeCount, hasAlert, showDot, attentionHasAction, hasErrors } = state
  // Unread system logs alone are informational → primary; everything else is an error color
  const badgeColor = hasAlert || attentionHasAction || hasErrors ? token.colorError : token.colorPrimary

  return (
    <Badge
      count={badgeCount > 0 ? badgeCount : 0}
      size="small"
      offset={offset}
      color={badgeColor}
      dot={showDot}
      style={{ color: token.colorTextLightSolid }}
    >
      {hasAlert ? (
        <InteractiveMorphIcon
          icon={AlertCircle}
          hoverIcon={AlertTriangle}
          size={size}
          className={attentionHasAction ? 'cb-attention-flash' : undefined}
          style={{ color: token.colorError }}
        />
      ) : (
        <LogsIcon style={{ fontSize: size }} />
      )}
    </Badge>
  )
}

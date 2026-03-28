import React from 'react'
import { theme } from 'antd'
import type { SessionStatus, SessionActivity } from '../../types/ai-workbench'

interface SessionStatusSVGProps {
  status: SessionStatus
  activity: SessionActivity
  size?: number
}

const SessionStatusSVG: React.FC<SessionStatusSVGProps> = ({ status, activity, size = 40 }) => {
  const { token } = theme.useToken()
  const scale = size / 40

  // ── closed: power-off circle ──
  if (status === 'closed') {
    return (
      <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
        <circle cx="20" cy="20" r="16" stroke={token.colorTextQuaternary} strokeWidth="1.5" fill="none" />
        <line x1="12" y1="20" x2="28" y2="20" stroke={token.colorTextQuaternary} strokeWidth="2" strokeLinecap="round" />
      </svg>
    )
  }

  // ── completed: green checkmark ──
  if (status === 'completed') {
    return (
      <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
        <circle cx="20" cy="20" r="16" stroke={token.colorSuccess} strokeWidth="2" fill="none" />
        <path d="M12 20l5 5 10-10" stroke={token.colorSuccess} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </svg>
    )
  }

  // ── error: red X ──
  if (status === 'error') {
    return (
      <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
        <circle cx="20" cy="20" r="16" stroke={token.colorError} strokeWidth="2" fill="none" />
        <path d="M14 14l12 12M26 14L14 26" stroke={token.colorError} strokeWidth="2.5" strokeLinecap="round" fill="none" />
      </svg>
    )
  }

  // ── auth_request: pulsing warning ring ──
  if (activity === 'auth_request') {
    return (
      <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
        <circle cx="20" cy="20" r="16" stroke={token.colorWarning} strokeWidth="2" fill="none">
          <animate attributeName="opacity" values="1;0.3;1" dur="1.2s" repeatCount="indefinite" />
        </circle>
        <line x1="20" y1="13" x2="20" y2="23" stroke={token.colorWarning} strokeWidth="2.5" strokeLinecap="round" />
        <circle cx="20" cy="27" r="1.5" fill={token.colorWarning} />
      </svg>
    )
  }

  // ── thinking: three pulsing dots ──
  if (activity === 'thinking') {
    return (
      <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
        <circle cx="10" cy="20" r="3.5" fill={token.colorPrimary}>
          <animate attributeName="opacity" values="0.3;1;0.3" dur="1.2s" repeatCount="indefinite" begin="0s" />
        </circle>
        <circle cx="20" cy="20" r="3.5" fill={token.colorPrimary}>
          <animate attributeName="opacity" values="0.3;1;0.3" dur="1.2s" repeatCount="indefinite" begin="0.2s" />
        </circle>
        <circle cx="30" cy="20" r="3.5" fill={token.colorPrimary}>
          <animate attributeName="opacity" values="0.3;1;0.3" dur="1.2s" repeatCount="indefinite" begin="0.4s" />
        </circle>
      </svg>
    )
  }

  // ── writing: text lines + blinking cursor ──
  if (activity === 'writing') {
    return (
      <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
        <line x1="6" y1="13" x2="28" y2="13" stroke={token.colorTextTertiary} strokeWidth="2" strokeLinecap="round" />
        <line x1="6" y1="20" x2="24" y2="20" stroke={token.colorTextTertiary} strokeWidth="2" strokeLinecap="round" />
        <line x1="6" y1="27" x2="16" y2="27" stroke={token.colorTextTertiary} strokeWidth="2" strokeLinecap="round" />
        <rect x="18" y="24" width="2" height="7" fill={token.colorPrimary}>
          <animate attributeName="opacity" values="1;0;1" dur="0.8s" repeatCount="indefinite" />
        </rect>
      </svg>
    )
  }

  // ── tool_call / reading: scanning highlight ──
  if (activity === 'tool_call' || activity === 'reading') {
    return (
      <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
        <line x1="6" y1="10" x2="34" y2="10" stroke={token.colorTextQuaternary} strokeWidth="2" strokeLinecap="round" />
        <line x1="6" y1="17" x2="34" y2="17" stroke={token.colorTextQuaternary} strokeWidth="2" strokeLinecap="round" />
        <line x1="6" y1="24" x2="34" y2="24" stroke={token.colorTextQuaternary} strokeWidth="2" strokeLinecap="round" />
        <line x1="6" y1="31" x2="26" y2="31" stroke={token.colorTextQuaternary} strokeWidth="2" strokeLinecap="round" />
        <rect x="4" y="8" width="32" height="4" rx="2" fill={token.colorPrimary} opacity="0.25">
          <animate attributeName="y" values="8;15;22;29;8" dur="2s" repeatCount="indefinite" />
        </rect>
      </svg>
    )
  }

  // ── waiting_input: blinking prompt cursor ──
  if (activity === 'waiting_input') {
    return (
      <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
        <text x="7" y="25" fontSize="14" fill={token.colorTextTertiary} fontFamily="monospace">&#x276F;</text>
        <line x1="22" y1="14" x2="22" y2="28" stroke={token.colorPrimary} strokeWidth="2.5" strokeLinecap="round">
          <animate attributeName="opacity" values="1;0;1" dur="1s" repeatCount="indefinite" />
        </line>
      </svg>
    )
  }

  // ── idle / none: dashed circle ──
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
      <circle cx="20" cy="20" r="16" stroke={token.colorTextQuaternary} strokeWidth="2" fill="none" strokeDasharray="4 3" />
      <circle cx="20" cy="20" r="3.5" fill={token.colorTextQuaternary} />
    </svg>
  )
}

export default SessionStatusSVG

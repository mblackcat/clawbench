import React, { useState } from 'react'
import { theme } from 'antd'

interface AppIconProps {
  icon?: string | null
  name?: string
  category?: string
  size?: number
  style?: React.CSSProperties
  className?: string
}

// Category fallback glyphs (stroke uses currentColor)
const DevCodeSvg: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <polyline points="16 18 22 12 16 6" />
    <polyline points="8 6 2 12 8 18" />
    <line x1="14" y1="4" x2="10" y2="20" />
  </svg>
)

const AutomationSvg: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </svg>
)

const UtilitiesSvg: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
  </svg>
)

const DataSvg: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <ellipse cx="12" cy="5" rx="9" ry="3" />
    <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
    <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
  </svg>
)

const AiSvg: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
  </svg>
)

const DefaultAppSvg: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
  </svg>
)

type IconComponent = React.FC<React.SVGProps<SVGSVGElement>>
type ThemeToken = ReturnType<typeof theme.useToken>['token']

/** Category (or name heuristic) → fallback glyph + token-based gradient. */
function getCategoryTheme(
  category: string | null | undefined,
  name: string | null | undefined,
  token: ThemeToken
): { Icon: IconComponent; bg: string } {
  const cat = (category || '').toLowerCase()
  const n = (name || '').toLowerCase()
  const gradient = (from: string, to: string): string =>
    `linear-gradient(135deg, ${from} 0%, ${to} 100%)`

  if (['development', 'dev', 'coding', 'code'].includes(cat) || /\b(code|dev)/.test(n)) {
    return { Icon: DevCodeSvg, bg: gradient(token.geekblue6, token.purple6) }
  }
  if (['automation', 'workflow', 'task'].includes(cat) || /\b(auto|flow)/.test(n)) {
    return { Icon: AutomationSvg, bg: gradient(token.gold6, token.orange6) }
  }
  if (['utilities', 'utility', 'tools', 'tool'].includes(cat) || /\btool/.test(n)) {
    return { Icon: UtilitiesSvg, bg: gradient(token.green6, token.cyan6) }
  }
  if (['data', 'database', 'db', 'analytics'].includes(cat) || /\bdata/.test(n)) {
    return { Icon: DataSvg, bg: gradient(token.blue6, token.geekblue6) }
  }
  if (['ai', 'agent', 'llm'].includes(cat) || /\b(ai|gpt|llm)\b/.test(n)) {
    return { Icon: AiSvg, bg: gradient(token.purple6, token.magenta6) }
  }
  return { Icon: DefaultAppSvg, bg: gradient(token.colorPrimary, token.colorPrimaryHover) }
}

export const AppIcon: React.FC<AppIconProps> = ({
  icon,
  name,
  category,
  size = 36,
  style,
  className
}) => {
  const { token } = theme.useToken()
  const [failed, setFailed] = useState(false)

  const hasCustomIcon = Boolean(icon && icon.trim() && !failed)
  const meta = getCategoryTheme(category, name, token)
  const FallbackIcon = meta.Icon

  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        overflow: 'hidden',
        background: hasCustomIcon ? token.colorFillSecondary : meta.bg,
        color: hasCustomIcon ? token.colorPrimary : token.colorTextLightSolid,
        border: hasCustomIcon ? `1px solid ${token.colorBorderSecondary}` : 'none',
        boxSizing: 'border-box',
        boxShadow: hasCustomIcon ? undefined : token.boxShadowTertiary,
        ...style
      }}
    >
      {hasCustomIcon ? (
        <img
          src={icon!}
          alt={name || ''}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          onError={() => setFailed(true)}
        />
      ) : (
        <FallbackIcon style={{ fontSize: Math.round(size * 0.52) }} />
      )}
    </div>
  )
}

export default AppIcon

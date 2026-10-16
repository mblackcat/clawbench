import React, { useMemo } from 'react'
import { theme } from 'antd'
import '../styles/workbench-cards.css'

export interface FolderCardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'regular' | 'builtin' | 'draft' | 'own-published'
  pinned?: boolean
  /** Small floating buttons rendered in the notch beside the folder tab. */
  notchActions?: React.ReactNode
  children: React.ReactNode
}

/**
 * CSS variables consumed by styles/workbench-cards.css, derived from antd
 * tokens so cards follow light/dark and palette changes. Spread onto any
 * container that renders `.cb-round-action-btn` outside a FolderCard.
 */
export function useWorkbenchCardVars(): React.CSSProperties {
  const { token } = theme.useToken()
  return useMemo(
    () =>
      ({
        '--cb-wc-bg': token.colorBgContainer,
        '--cb-wc-builtin-bg': token.colorPrimaryBg,
        '--cb-wc-text': token.colorText,
        '--cb-wc-text-secondary': token.colorTextSecondary,
        '--cb-wc-fill': token.colorFillSecondary,
        '--cb-wc-fill-hover': token.colorFill,
        '--cb-wc-border': token.colorBorder,
        '--cb-wc-accent': token.colorPrimary,
        '--cb-wc-accent-shadow': token.colorPrimaryBorder,
        '--cb-wc-danger': token.colorError,
        '--cb-wc-on-accent': token.colorTextLightSolid,
        '--cb-wc-shadow': token.colorFillSecondary
      }) as React.CSSProperties,
    [token]
  )
}

export const FolderCard: React.FC<FolderCardProps> = ({
  variant = 'regular',
  pinned = false,
  notchActions,
  children,
  className = '',
  style,
  ...restProps
}) => {
  const cardVars = useWorkbenchCardVars()
  const variantClass =
    variant === 'builtin'
      ? 'cb-card-builtin'
      : variant === 'draft'
        ? 'cb-card-draft'
        : variant === 'own-published'
          ? 'cb-card-own-published'
          : ''

  return (
    <div
      className={`cb-folder-card ${variantClass} ${pinned ? 'cb-card-pinned' : ''} ${className}`
        .replace(/\s+/g, ' ')
        .trim()}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        minHeight: 140,
        boxSizing: 'border-box',
        ...cardVars,
        ...style
      }}
      {...restProps}
    >
      <div className="cb-folder-card-bg-tab" />
      <div className="cb-folder-card-bg-body" />
      <div className="cb-folder-card-bg-fillet" />
      {notchActions && <div className="cb-folder-notch-actions">{notchActions}</div>}
      <div className="cb-folder-card-content">{children}</div>
    </div>
  )
}

export default FolderCard

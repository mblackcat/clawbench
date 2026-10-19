import React from 'react'
import '../styles/workbench-cards.css'

export interface FolderCardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'regular' | 'builtin' | 'draft' | 'own-published'
  pinned?: boolean
  /** Small floating buttons rendered in the notch beside the folder tab. */
  notchActions?: React.ReactNode
  children: React.ReactNode
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

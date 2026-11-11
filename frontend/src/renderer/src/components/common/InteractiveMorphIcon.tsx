import React, { useEffect, useRef, useState } from 'react'
import { MorphIcon } from 'morphicons/react'
import type { IconInput, SpringPreset } from 'morphicons/react'
import { useMotionEnabled } from '../../motion'
import { resolveMorphIconSize } from './AntdMorphIcon'

export interface InteractiveMorphIconProps {
  /** Base icon when idle (lucide icon data, e.g. `import { Plus } from 'lucide'`) */
  icon: IconInput
  /** Icon to morph into when hovered */
  hoverIcon?: IconInput
  /** Icon to morph into when pressed or active */
  activeIcon?: IconInput
  /** Controlled active / selected state (e.g. the current sidebar route) */
  active?: boolean
  /** Controlled hovered state (overrides hover detection) */
  hovered?: boolean
  /** Icon size in px or a CSS length (defaults to 1em, i.e. inherits font-size) */
  size?: number | string
  /** Spring physics preset ('bouncy' by default for lively micro-interactions) */
  spring?: SpringPreset
  /** Stroke width (default 2) */
  strokeWidth?: number | string
  /**
   * Hover detection scope: 'parent' listens on the closest interactive container
   * (button / menu item / tab / …) so hovering the whole control animates the icon;
   * 'self' listens on the icon only.
   */
  triggerScope?: 'parent' | 'self'
  className?: string
  style?: React.CSSProperties
  title?: string
  onClick?: React.MouseEventHandler<HTMLSpanElement>
}

/** Closest interactive container that drives the hover / press state. */
const TRIGGER_SELECTOR = [
  '.ant-menu-item',
  '.ant-dropdown-menu-item',
  '[role="menuitem"]',
  'button',
  '.ant-btn',
  '[role="button"]',
  '[role="tab"]',
  '.ant-segmented-item',
  '.cb-round-action-btn',
  '.cb-notch-btn',
  '.cb-win-btn',
  '.cb-sidebar-bottom-btn',
  '.cb-interactive-target'
].join(', ')

const SCALE_HOVER = 'scale(1.12)'
const SCALE_PRESS = 'scale(0.88)'
const SCALE_IDLE = 'scale(1)'
const SPRING_TRANSITION = 'transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1)'

/**
 * Icon with spring micro-interactions: grows on hover, shrinks on press and
 * morphs (morphicons) into `hoverIcon` / `activeIcon`.
 *
 * Follows the global motion switch (`motion/pref.ts`): in 敏捷 (agile) mode
 * there is no scaling, no transition and no hover morph — only the semantic
 * `active` icon is kept, swapped instantly.
 */
export const InteractiveMorphIcon: React.FC<InteractiveMorphIconProps> = ({
  icon,
  hoverIcon,
  activeIcon,
  active = false,
  hovered: controlledHovered,
  size,
  spring = 'bouncy',
  strokeWidth = 2,
  triggerScope = 'parent',
  className = '',
  style,
  title,
  onClick
}) => {
  const motionEnabled = useMotionEnabled()
  const [internalHovered, setInternalHovered] = useState(false)
  const [pressed, setPressed] = useState(false)
  const containerRef = useRef<HTMLSpanElement>(null)

  const isHovered = controlledHovered !== undefined ? controlledHovered : internalHovered

  useEffect(() => {
    if (!motionEnabled) {
      setInternalHovered(false)
      setPressed(false)
      return
    }
    const el = containerRef.current
    if (!el) return
    const target =
      triggerScope === 'parent' ? (el.closest<HTMLElement>(TRIGGER_SELECTOR) ?? el) : el

    const onEnter = (): void => setInternalHovered(true)
    const onLeave = (): void => {
      setInternalHovered(false)
      setPressed(false)
    }
    const onDown = (): void => setPressed(true)
    const onUp = (): void => setPressed(false)

    target.addEventListener('mouseenter', onEnter)
    target.addEventListener('mouseleave', onLeave)
    target.addEventListener('mousedown', onDown)
    target.addEventListener('mouseup', onUp)
    return () => {
      target.removeEventListener('mouseenter', onEnter)
      target.removeEventListener('mouseleave', onLeave)
      target.removeEventListener('mousedown', onDown)
      target.removeEventListener('mouseup', onUp)
    }
  }, [triggerScope, motionEnabled])

  // Which glyph to show. Motion on: pressed → active → hover → base.
  // Motion off: only the semantic `active` icon, never a hover morph.
  let currentIcon = icon
  if (motionEnabled) {
    if (pressed && activeIcon) currentIcon = activeIcon
    else if (active && (activeIcon || hoverIcon)) currentIcon = (activeIcon || hoverIcon)!
    else if (isHovered && hoverIcon) currentIcon = hoverIcon
  } else if (active && activeIcon) {
    currentIcon = activeIcon
  }

  const transform = motionEnabled
    ? pressed
      ? SCALE_PRESS
      : isHovered
        ? SCALE_HOVER
        : SCALE_IDLE
    : 'none'

  return (
    <span
      ref={containerRef}
      role="img"
      title={title}
      className={`anticon interactive-morph-icon cb-morph-icon ${className}`.trim()}
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        lineHeight: 1,
        verticalAlign: '-0.125em',
        ...style,
        transform,
        transition: motionEnabled ? SPRING_TRANSITION : 'none'
      }}
    >
      <MorphIcon
        icon={currentIcon}
        size={resolveMorphIconSize(size, style)}
        strokeWidth={strokeWidth}
        spring={motionEnabled ? spring : undefined}
        reducedMotion={motionEnabled ? 'never' : 'always'}
        color="currentColor"
      />
    </span>
  )
}

export default InteractiveMorphIcon

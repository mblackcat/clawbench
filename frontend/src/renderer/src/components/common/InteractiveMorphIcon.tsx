import React, { useEffect, useRef, useState } from 'react'
import { useMotionEnabled } from '../../motion'

/** An icon element (`<SettingOutlined />`) or component (`SettingOutlined`). */
export type MorphIconSource = React.ReactNode | React.ComponentType<object>

export interface InteractiveMorphIconProps {
  /** Base icon when idle */
  icon: MorphIconSource
  /** Icon to swap to while hovered */
  hoverIcon?: MorphIconSource
  /** Icon to swap to while pressed, or while `active` */
  activeIcon?: MorphIconSource
  /** Controlled active / selected state (e.g. the current sidebar route) */
  active?: boolean
  /** Controlled hovered state (overrides hover detection) */
  hovered?: boolean
  /**
   * Identity of a state-driven glyph (e.g. `expanded`, `copied`). When it changes
   * the new `icon` cross-fades in, like a hover swap.
   */
  swapKey?: string | number | boolean
  /** Icon size in px or a CSS length (defaults to 1em, i.e. inherits font-size) */
  size?: number | string
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

function renderSource(source: MorphIconSource): React.ReactNode {
  if (React.isValidElement(source)) return source
  // Component reference: plain function or forwardRef / memo object (antd icons)
  const isComponent =
    typeof source === 'function' ||
    (typeof source === 'object' && source !== null && '$$typeof' in source)
  if (isComponent) {
    const Comp = source as React.ComponentType<object>
    return <Comp />
  }
  return source as React.ReactNode
}

/**
 * Icon with spring micro-interactions: grows on hover, shrinks on press and
 * swaps to `hoverIcon` / `activeIcon` with a short cross-fade.
 *
 * Follows the global motion switch (`motion/pref.ts`): in 敏捷 (agile) mode
 * there is no scaling, no transition and no hover swap — only the semantic
 * `active` icon is kept.
 */
export const InteractiveMorphIcon: React.FC<InteractiveMorphIconProps> = ({
  icon,
  hoverIcon,
  activeIcon,
  active = false,
  hovered: controlledHovered,
  swapKey,
  size,
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
  // Motion off: only the semantic `active` icon, never a hover swap.
  let stateKey: 'base' | 'hover' | 'active' = 'base'
  if (motionEnabled) {
    if (pressed && activeIcon) stateKey = 'active'
    else if (active && activeIcon) stateKey = 'active'
    else if (active && hoverIcon) stateKey = 'hover'
    else if (isHovered && hoverIcon) stateKey = 'hover'
  } else if (active && activeIcon) {
    stateKey = 'active'
  }
  const current = stateKey === 'active' ? activeIcon : stateKey === 'hover' ? hoverIcon : icon

  // Only cross-fade after the first swap, so plain mounts (route changes) don't flash
  const layerKey = `${stateKey}:${String(swapKey ?? '')}`
  const initialKeyRef = useRef(layerKey)
  const swappedRef = useRef(false)
  if (layerKey !== initialKeyRef.current) swappedRef.current = true

  let fontSize: number | string | undefined = size
  if (fontSize === undefined && style?.fontSize !== undefined) fontSize = style.fontSize

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
      className={`anticon cb-morph-icon ${className}`.trim()}
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        lineHeight: 1,
        verticalAlign: '-0.125em',
        ...style,
        ...(fontSize !== undefined ? { fontSize } : null),
        transform,
        transition: motionEnabled ? SPRING_TRANSITION : 'none'
      }}
    >
      {/* Re-keyed on every glyph swap so the cross-fade keyframe replays */}
      <span
        key={layerKey}
        className={`cb-morph-layer${motionEnabled && swappedRef.current ? ' cb-morph-layer-in' : ''}`}
        style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
      >
        {renderSource(current)}
      </span>
    </span>
  )
}

export default InteractiveMorphIcon

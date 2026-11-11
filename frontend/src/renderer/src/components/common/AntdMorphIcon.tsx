import React, { forwardRef } from 'react'
import { MorphIcon } from 'morphicons/react'
import type { MorphIconProps, MorphHandle, IconInput, SpringPreset } from 'morphicons/react'
import { useMotionEnabled } from '../../motion'

export interface AntdMorphIconProps extends Omit<MorphIconProps, 'size' | 'ref' | 'icon' | 'onClick'> {
  icon?: IconInput
  size?: number | string
  spring?: SpringPreset
  className?: string
  style?: React.CSSProperties
  title?: string
  onClick?: React.MouseEventHandler<HTMLSpanElement>
}

/** `size` wins; otherwise a numeric / `NNpx` `style.fontSize`; otherwise `1em` (inherit font-size). */
export function resolveMorphIconSize(
  size: number | string | undefined,
  style: React.CSSProperties | undefined
): number | string {
  if (size !== undefined) return size
  const fs = style?.fontSize
  if (typeof fs === 'number') return fs
  if (typeof fs === 'string' && /^\d+px$/.test(fs)) return parseInt(fs, 10)
  return '1em'
}

/**
 * Ant Design compatible wrapper for MorphIcon (lucide icon data).
 * Renders inside an `anticon` span so it sizes / aligns like an antd icon in
 * Buttons, Menus and Tooltips, and paints with `currentColor` (theme tokens).
 * Follows the global motion switch: when motion is off a changed `icon` swaps instantly.
 */
export const AntdMorphIcon = forwardRef<MorphHandle, AntdMorphIconProps>(function AntdMorphIcon(
  { icon, size, spring = 'snappy', className = '', style, strokeWidth = 2, title, onClick, ...rest },
  ref
) {
  const motionEnabled = useMotionEnabled()

  return (
    <span
      role="img"
      className={`anticon ${className}`.trim()}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        lineHeight: 1,
        verticalAlign: '-0.125em',
        ...style
      }}
      title={title}
      onClick={onClick}
    >
      <MorphIcon
        ref={ref}
        icon={icon}
        size={resolveMorphIconSize(size, style)}
        strokeWidth={strokeWidth}
        spring={motionEnabled ? spring : undefined}
        reducedMotion={motionEnabled ? 'never' : 'always'}
        color="currentColor"
        {...rest}
      />
    </span>
  )
})

export default AntdMorphIcon

export type { MorphHandle, IconInput, SpringPreset }

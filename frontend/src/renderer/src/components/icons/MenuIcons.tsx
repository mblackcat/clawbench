import React from 'react'
import Icon from '@ant-design/icons'
import type { CustomIconComponentProps } from '@ant-design/icons/lib/components/Icon'

/**
 * Main sidebar menu icons — monochrome, follow theme via currentColor.
 * Stroke-based 24×24 glyphs, optically balanced at 14–16px.
 */

// ── Workbench: 2×2 resource cards (apps / skills / prompts hub) ──
const WorkbenchSvg = () => (
  <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="3" y="3" width="7.5" height="7.5" rx="1.75" stroke="currentColor" strokeWidth="1.75" />
    <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.75" stroke="currentColor" strokeWidth="1.75" />
    <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.75" stroke="currentColor" strokeWidth="1.75" />
    {/* Active / favorite card */}
    <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.75" stroke="currentColor" strokeWidth="1.75" />
    <path
      d="M17.25 15.15l.62 1.45h1.55l-1.25.95.48 1.5-1.4-.95-1.4.95.48-1.5-1.25-.95h1.55l.62-1.45z"
      fill="currentColor"
    />
  </svg>
)

// ── AI Chat: speech bubble with AI spark ──
const AIChatSvg = () => (
  <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M4.75 5.5A2.25 2.25 0 017 3.25h10A2.25 2.25 0 0119.25 5.5v6.25A2.25 2.25 0 0117 14H10.4L6.5 17.25V14H7A2.25 2.25 0 014.75 11.75V5.5z"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinejoin="round"
    />
    {/* AI spark inside bubble */}
    <path
      d="M12 6.4l.85 2.05H15l-1.7 1.3.65 2.05L12 10.55l-1.95 1.25.65-2.05-1.7-1.3h2.15L12 6.4z"
      fill="currentColor"
    />
  </svg>
)

// ── AI Coding: code brackets </> ──
const AICodingSvg = () => (
  <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M8.5 6.5L3.75 12 8.5 17.5"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M15.5 6.5L20.25 12 15.5 17.5"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M13.4 5.5L10.6 18.5"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
    />
  </svg>
)

// ── CoPiper: structured table + pipe/export arrow ──
const CopiperSvg = () => (
  <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="2.75" y="3.75" width="13" height="16.5" rx="2" stroke="currentColor" strokeWidth="1.75" />
    <path d="M2.75 8.5h13" stroke="currentColor" strokeWidth="1.75" />
    <path d="M9.25 8.5v11.75" stroke="currentColor" strokeWidth="1.5" />
    <path d="M2.75 13h13" stroke="currentColor" strokeWidth="1.25" />
    <path d="M2.75 17h13" stroke="currentColor" strokeWidth="1.25" />
    {/* Pipe / export */}
    <path
      d="M17.5 12h3.75m0 0L19 9.75M21.25 12L19 14.25"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

type MenuIconProps = Partial<CustomIconComponentProps>

export const WorkbenchIcon = (props: MenuIconProps) => (
  <Icon component={WorkbenchSvg} {...props} />
)

export const AIChatIcon = (props: MenuIconProps) => (
  <Icon component={AIChatSvg} {...props} />
)

export const AICodingIcon = (props: MenuIconProps) => (
  <Icon component={AICodingSvg} {...props} />
)

export const CopiperIcon = (props: MenuIconProps) => (
  <Icon component={CopiperSvg} {...props} />
)

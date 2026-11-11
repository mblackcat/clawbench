import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import PaneTabBar from '../PaneTabBar'
import type { AICodingSession, AICodingWorkspace } from '../../../types/ai-coding'

interface RenderedComponent {
  root: Root
  container: HTMLDivElement
}

const mounted: RenderedComponent[] = []

beforeAll(() => {
  const getComputedStyle = window.getComputedStyle.bind(window)
  window.getComputedStyle = (element: Element) => getComputedStyle(element)
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({
      matches: false,
      media: '',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))
  })
  globalThis.ResizeObserver = class ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  while (mounted.length > 0) {
    const item = mounted.pop()
    act(() => {
      item?.root.unmount()
    })
    item?.container.remove()
  }
})

function renderComponent(ui: React.ReactElement): HTMLDivElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(ui)
  })
  mounted.push({ root, container })
  return container
}

describe('PaneTabBar close icon', () => {
  it('renders close button when onClose is provided, and calls onClose on click', () => {
    const onClose = vi.fn()
    const container = renderComponent(
      <PaneTabBar
        paneId="landing"
        tabs={[]}
        activeTabId={null}
        workingDir="/test/dir"
        onSelectTab={vi.fn()}
        onCloseTab={vi.fn()}
        onNewSession={vi.fn()}
        onClose={onClose}
      />
    )

    const closeBtn = container.querySelector('button[aria-label="关闭"], button[aria-label="Close"]')
    expect(closeBtn).not.toBeNull()

    act(() => {
      closeBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not render close button when onClose is not provided', () => {
    const container = renderComponent(
      <PaneTabBar
        paneId="pane-1"
        tabs={[]}
        activeTabId={null}
        workingDir="/test/dir"
        onSelectTab={vi.fn()}
        onCloseTab={vi.fn()}
        onNewSession={vi.fn()}
      />
    )

    const closeBtn = container.querySelector('button[aria-label="关闭"], button[aria-label="Close"]')
    expect(closeBtn).toBeNull()
  })
})

describe('resolveDefaultLandingWorkspace resolution logic', () => {
  function isSamePath(a: string, b: string): boolean {
    const normA = a.replace(/\\/g, '/').replace(/\/$/, '')
    const normB = b.replace(/\\/g, '/').replace(/\/$/, '')
    return normA.toLowerCase() === normB.toLowerCase()
  }

  function resolveTargetWorkspace(params: {
    sessions: AICodingSession[]
    workspaces: AICodingWorkspace[]
    activeWorkbenchPath?: string
  }): string | null {
    const { sessions, workspaces, activeWorkbenchPath } = params

    // 1. Last session's workspace
    const validSessions = sessions.filter((s) => workspaces.some((w) => w.id === s.workspaceId))
    if (validSessions.length > 0) {
      const lastSession = [...validSessions].sort((a, b) => {
        const aTime = a.updatedAt || a.startedAt || a.createdAt || 0
        const bTime = b.updatedAt || b.startedAt || b.createdAt || 0
        return bTime - aTime
      })[0]
      return lastSession.workspaceId
    }

    // 2. First time use: Workbench's active workspace
    if (activeWorkbenchPath) {
      const matched = workspaces.find((w) => isSamePath(w.workingDir, activeWorkbenchPath))
      if (matched) return matched.id
    }

    // 3. Fallback
    return workspaces[0]?.id ?? null
  }

  it('selects the workspace with the most recent session when sessions exist', () => {
    const workspaces: AICodingWorkspace[] = [
      { id: 'ws-1', title: 'ws1', workingDir: '/ws1', groupId: 'default', createdAt: 100, updatedAt: 100 },
      { id: 'ws-2', title: 'ws2', workingDir: '/ws2', groupId: 'default', createdAt: 200, updatedAt: 200 }
    ]
    const sessions: AICodingSession[] = [
      { id: 's-1', workspaceId: 'ws-1', toolType: 'claude', source: 'local', status: 'idle', lastActivity: 'none', createdAt: 1000, updatedAt: 2000 },
      { id: 's-2', workspaceId: 'ws-2', toolType: 'codex', source: 'local', status: 'idle', lastActivity: 'none', createdAt: 1500, updatedAt: 5000 },
      { id: 's-3', workspaceId: 'ws-1', toolType: 'claude', source: 'local', status: 'idle', lastActivity: 'none', createdAt: 3000, updatedAt: 4000 }
    ]

    const target = resolveTargetWorkspace({
      sessions,
      workspaces,
      activeWorkbenchPath: '/ws-1'
    })

    // s-2 has updatedAt 5000, which belongs to ws-2
    expect(target).toBe('ws-2')
  })

  it('falls back to workbench active workspace when no sessions exist (first time use)', () => {
    const workspaces: AICodingWorkspace[] = [
      { id: 'ws-1', title: 'ws1', workingDir: 'C:\\Users\\dev\\project1', groupId: 'default', createdAt: 100, updatedAt: 100 },
      { id: 'ws-2', title: 'ws2', workingDir: 'C:\\Users\\dev\\project2', groupId: 'default', createdAt: 200, updatedAt: 200 }
    ]

    const target = resolveTargetWorkspace({
      sessions: [],
      workspaces,
      activeWorkbenchPath: 'c:/users/dev/project2/'
    })

    expect(target).toBe('ws-2')
  })

  it('falls back to first workspace when active workbench workspace is not set and no sessions exist', () => {
    const workspaces: AICodingWorkspace[] = [
      { id: 'ws-1', title: 'ws1', workingDir: '/ws1', groupId: 'default', createdAt: 100, updatedAt: 100 }
    ]

    const target = resolveTargetWorkspace({
      sessions: [],
      workspaces
    })

    expect(target).toBe('ws-1')
  })
})

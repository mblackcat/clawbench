import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import PaneTabBar from '../../../pages/AICoding/PaneTabBar'
import WorkspaceLandingPanel from '../../../pages/AICoding/WorkspaceLandingPanel'
import { InteractiveMorphIcon } from '../InteractiveMorphIcon'
import { Database, DatabaseZap, ArrowUpCircle, CircleChevronsUp, Search as SearchIcon, Sparkles } from 'lucide'
import { setMotionMode } from '../../../motion'
import type { AICodingWorkspace } from '../../../types/ai-coding'

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn()
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mockWorkspace: AICodingWorkspace = {
  id: 'ws-test',
  title: 'Test Workspace',
  workingDir: '/workspace/test',
  groupId: 'default',
  createdAt: 100,
  updatedAt: 100
}

describe('Icon Animation Regression & Optimization Tests', () => {
  let container: HTMLDivElement
  let root: Root

  beforeAll(() => {
    if (!window.matchMedia) {
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
    }
    globalThis.ResizeObserver ??= class ResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
  })

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    localStorage.clear()
    setMotionMode('elegant')
    vi.stubGlobal('api', {
      aiCoding: {
        detectTools: vi.fn().mockResolvedValue([]),
        openDirectory: vi.fn().mockResolvedValue('')
      },
      vcs: {
        changedFiles: vi.fn().mockResolvedValue({ files: [] }),
        detectAll: vi.fn().mockResolvedValue([])
      },
      developer: {
        getAvailableIdes: vi.fn().mockResolvedValue([]),
        openInIde: vi.fn().mockResolvedValue(true)
      }
    })
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
    localStorage.clear()
    vi.unstubAllGlobals()
  })

  const hoverScale = async (btn: HTMLElement, iconSpan: HTMLElement): Promise<void> => {
    await act(async () => {
      btn.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
    })
    expect(iconSpan.style.transform).toBe('scale(1.12)')
    await act(async () => {
      btn.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }))
    })
    expect(iconSpan.style.transform).toBe('scale(1)')
  }

  // OSS: the landing view is closed from its PaneTabBar (VB put the button in WorkspaceLandingPanel)
  it('landing close button uses an interactive morph icon (X ⇄ CircleX, not a refresh icon)', async () => {
    const onClose = vi.fn()
    await act(async () => {
      root.render(
        <PaneTabBar
          paneId="landing"
          tabs={[]}
          activeTabId={null}
          workingDir={mockWorkspace.workingDir}
          onSelectTab={vi.fn()}
          onCloseTab={vi.fn()}
          onNewSession={vi.fn()}
          onToggleTerminalPanel={vi.fn()}
          onToggleGitPanel={vi.fn()}
          onClose={onClose}
        />
      )
    })

    const closeBtn = container.querySelector(
      'button[aria-label="关闭"], button[aria-label="Close"]'
    ) as HTMLButtonElement
    expect(closeBtn).toBeTruthy()
    const iconSpan = closeBtn.querySelector('.interactive-morph-icon') as HTMLElement
    expect(iconSpan).toBeTruthy()

    await hoverScale(closeBtn, iconSpan)
  })

  it('WorkspaceLandingPanel quick-start cards use interactive morph icons', async () => {
    await act(async () => {
      root.render(
        <WorkspaceLandingPanel
          workspace={mockWorkspace}
          onOpenSession={vi.fn()}
          onNewSession={vi.fn()}
          onOpenTerminal={vi.fn()}
          onToggleChanges={vi.fn()}
          changesOpen={false}
        />
      )
    })
    expect(container.querySelectorAll('.interactive-morph-icon').length).toBeGreaterThanOrEqual(3)
  })

  it('InteractiveMorphIcon with Database and DatabaseZap behaves correctly', async () => {
    await act(async () => {
      root.render(
        <button id="db-btn">
          <InteractiveMorphIcon icon={Database} hoverIcon={DatabaseZap} size={14} />
        </button>
      )
    })
    const btn = container.querySelector('#db-btn') as HTMLElement
    const iconSpan = container.querySelector('.interactive-morph-icon') as HTMLElement
    expect(iconSpan).toBeTruthy()
    await hoverScale(btn, iconSpan)
  })

  it('InteractiveMorphIcon with ArrowUpCircle and CircleChevronsUp behaves correctly', async () => {
    await act(async () => {
      root.render(
        <button id="upgrade-btn">
          <InteractiveMorphIcon icon={ArrowUpCircle} hoverIcon={CircleChevronsUp} size={13} />
        </button>
      )
    })
    const btn = container.querySelector('#upgrade-btn') as HTMLElement
    const iconSpan = container.querySelector('.interactive-morph-icon') as HTMLElement
    expect(iconSpan).toBeTruthy()
    await hoverScale(btn, iconSpan)
  })

  it('InteractiveMorphIcon with Search and Sparkles behaves correctly', async () => {
    await act(async () => {
      root.render(
        <button id="search-btn">
          <InteractiveMorphIcon icon={SearchIcon} hoverIcon={Sparkles} size={16} />
        </button>
      )
    })
    const btn = container.querySelector('#search-btn') as HTMLElement
    const iconSpan = container.querySelector('.interactive-morph-icon') as HTMLElement
    expect(iconSpan).toBeTruthy()
    await hoverScale(btn, iconSpan)
  })
})

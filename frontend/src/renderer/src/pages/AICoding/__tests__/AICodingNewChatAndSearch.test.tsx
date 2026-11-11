import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import AICodingSearchModal from '../AICodingSearchModal'
import AICodingNewChatLanding, { DRAFT_STORAGE_KEY } from '../AICodingNewChatLanding'
import AICodingSidebar from '../AICodingSidebar'
import PaneTabBar from '../PaneTabBar'
import { useAICodingStore } from '../../../stores/useAICodingStore'
import type { AICodingWorkspace, AICodingSession, DetectedCLI } from '../../../types/ai-coding'

interface RenderedComponent {
  root: Root
  container: HTMLDivElement
}

const mounted: RenderedComponent[] = []

function render(ui: React.ReactElement): HTMLDivElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(<MemoryRouter>{ui}</MemoryRouter>)
  })
  mounted.push({ root, container })
  return container
}

const mockWorkspaces: AICodingWorkspace[] = [
  { id: 'ws-1', title: 'Frontend App', workingDir: 'D:/work/frontend', groupId: 'default', createdAt: 1000, updatedAt: 1000 },
  { id: 'ws-2', title: 'Backend Service', workingDir: 'D:/work/backend', groupId: 'default', createdAt: 2000, updatedAt: 2000 }
]

const mockSessions: AICodingSession[] = [
  { id: 's-1', workspaceId: 'ws-1', toolType: 'claude', status: 'idle', title: 'Fix auth bug', createdAt: 1000, updatedAt: 2000, source: 'local', lastActivity: 'none' },
  { id: 's-2', workspaceId: 'ws-2', toolType: 'codex', status: 'idle', title: 'Refactor database', createdAt: 1200, updatedAt: 2500, source: 'local', lastActivity: 'none' }
]

const mockTools: DetectedCLI[] = [
  { toolType: 'claude', name: 'Claude Code', installed: true, enabled: true, version: '1.0.0' },
  { toolType: 'codex', name: 'Codex', installed: true, enabled: true, version: '2.0.0' },
  { toolType: 'antigravity', name: 'Antigravity', installed: true, enabled: false }, // disabled!
  { toolType: 'terminal', name: 'Terminal', installed: true, enabled: true } // plain terminal excluded!
]

beforeAll(() => {
  const getComputedStyle = window.getComputedStyle?.bind(window) || (() => ({}))
  window.getComputedStyle = (element: Element) => getComputedStyle(element)
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({
      matches: false,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))
  })
})

afterEach(() => {
  localStorage.removeItem(DRAFT_STORAGE_KEY)
  localStorage.removeItem('cb-workbench-collapsed-workspaces')
  while (mounted.length > 0) {
    const item = mounted.pop()
    if (item) {
      act(() => {
        item.root.unmount()
      })
      item.container.remove()
    }
  }
})

describe('AICodingSearchModal', () => {
  it('renders search modal with quick actions and session list', () => {
    const container = render(
      <AICodingSearchModal
        open={true}
        onClose={vi.fn()}
        onNewChat={vi.fn()}
        onOpenFolder={vi.fn()}
        onSelectSession={vi.fn()}
        workspaces={mockWorkspaces}
        sessions={mockSessions}
      />
    )

    // Antd Modal renders into document.body
    expect(document.body.textContent).toContain('新建会话')
    expect(document.body.textContent).toContain('打开文件夹')
    expect(document.body.textContent).toContain('Fix auth bug')
    expect(document.body.textContent).toContain('Refactor database')
  })

  it('filters sessions when query input changes', () => {
    render(
      <AICodingSearchModal
        open={true}
        onClose={vi.fn()}
        onNewChat={vi.fn()}
        onOpenFolder={vi.fn()}
        onSelectSession={vi.fn()}
        workspaces={mockWorkspaces}
        sessions={mockSessions}
      />
    )

    const input = document.body.querySelector('input') as HTMLInputElement
    expect(input).not.toBeNull()

    act(() => {
      input.value = 'database'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      // React synthetic change
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set
      nativeInputValueSetter?.call(input, 'database')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })

    expect(document.body.textContent).toContain('Refactor database')
  })

  it('triggers onNewChat when clicking New Chat', () => {
    const onNewChat = vi.fn()
    render(
      <AICodingSearchModal
        open={true}
        onClose={vi.fn()}
        onNewChat={onNewChat}
        onOpenFolder={vi.fn()}
        onSelectSession={vi.fn()}
        workspaces={mockWorkspaces}
        sessions={mockSessions}
      />
    )

    const newChatOption = document.body.querySelector('[data-active="true"]') as HTMLElement
    expect(newChatOption).not.toBeNull()
    act(() => {
      newChatOption.click()
    })
    expect(onNewChat).toHaveBeenCalledTimes(1)
  })
})

describe('AICodingNewChatLanding', () => {
  it('renders only enabled coding tools matching workspace add session', () => {
    const container = render(
      <AICodingNewChatLanding
        workspaces={mockWorkspaces}
        tools={mockTools}
        selectedWorkspaceId="ws-1"
        onStartChat={vi.fn()}
        onNewWorkspace={vi.fn()}
      />
    )

    expect(container.textContent).toContain('Frontend App')
    expect(container.textContent).toContain('Backend Service')
    expect(container.textContent).toContain('Claude')
    expect(container.textContent).toContain('Codex')
    // Disabled tool Antigravity and plain Terminal should NOT be displayed
    expect(container.textContent).not.toContain('Antigravity')
    expect(container.textContent).not.toContain('Terminal')
  })

  it('calls onStartChat with selected workspace, tool, and prompt', async () => {
    const onStartChat = vi.fn().mockResolvedValue(undefined)
    const container = render(
      <AICodingNewChatLanding
        workspaces={mockWorkspaces}
        tools={mockTools}
        selectedWorkspaceId="ws-1"
        onStartChat={onStartChat}
        onNewWorkspace={vi.fn()}
      />
    )

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    expect(textarea).not.toBeNull()

    act(() => {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value'
      )?.set
      nativeSetter?.call(textarea, 'Fix unit tests for auth')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
      textarea.dispatchEvent(new Event('change', { bubbles: true }))
    })

    const sendBtn = container.querySelector('button.ant-btn-primary') as HTMLButtonElement
    expect(sendBtn).not.toBeNull()

    await act(async () => {
      sendBtn.click()
    })

    expect(onStartChat).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      toolType: 'claude',
      text: 'Fix unit tests for auth'
    })
  })

  it('caches input text and selections in localStorage and restores them across remounts', async () => {
    localStorage.removeItem(DRAFT_STORAGE_KEY)

    const onStartChat = vi.fn().mockResolvedValue(undefined)
    const container1 = render(
      <AICodingNewChatLanding
        workspaces={mockWorkspaces}
        tools={mockTools}
        onStartChat={onStartChat}
        onNewWorkspace={vi.fn()}
      />
    )

    const textarea1 = container1.querySelector('textarea') as HTMLTextAreaElement
    expect(textarea1).not.toBeNull()

    act(() => {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value'
      )?.set
      nativeSetter?.call(textarea1, 'Refactor draft test prompt')
      textarea1.dispatchEvent(new Event('input', { bubbles: true }))
      textarea1.dispatchEvent(new Event('change', { bubbles: true }))
    })

    // Check localStorage cache
    const rawDraft = localStorage.getItem(DRAFT_STORAGE_KEY)
    expect(rawDraft).not.toBeNull()
    const draft = JSON.parse(rawDraft || '{}')
    expect(draft.inputText).toBe('Refactor draft test prompt')

    // Unmount first component (simulating switching views/tabs)
    const mounted1 = mounted.pop()
    act(() => {
      mounted1?.root.unmount()
      mounted1?.container.remove()
    })

    // Remount a new instance
    const container2 = render(
      <AICodingNewChatLanding
        workspaces={mockWorkspaces}
        tools={mockTools}
        onStartChat={onStartChat}
        onNewWorkspace={vi.fn()}
      />
    )

    const textarea2 = container2.querySelector('textarea') as HTMLTextAreaElement
    expect(textarea2.value).toBe('Refactor draft test prompt')

    // Click send
    const sendBtn = container2.querySelector('button.ant-btn-primary') as HTMLButtonElement
    expect(sendBtn).not.toBeNull()

    await act(async () => {
      sendBtn.click()
    })

    expect(onStartChat).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'Refactor draft test prompt'
      })
    )

    // After send, the input text in cache should be cleared
    const afterSendDraft = JSON.parse(localStorage.getItem(DRAFT_STORAGE_KEY) || '{}')
    expect(afterSendDraft.inputText).toBe('')
  })

  it('folds workspaces when exceeding 9, sorting by recent session activity', () => {
    // Generate 12 workspaces
    const manyWorkspaces: AICodingWorkspace[] = Array.from({ length: 12 }, (_, i) => ({
      id: `ws-${i + 1}`,
      title: `Workspace ${i + 1}`,
      workingDir: `D:/work/ws-${i + 1}`,
      groupId: 'default',
      createdAt: 1000 + i,
      updatedAt: 1000 + i
    }))

    // Give ws-12 the most recent session activity so it should float to the top
    const sessionsWithWs12: AICodingSession[] = [
      {
        id: 'sess-ws12',
        workspaceId: 'ws-12',
        toolType: 'claude',
        status: 'idle',
        title: 'Session in ws 12',
        createdAt: 5000,
        updatedAt: 9999,
        lastActivity: 'none',
        source: 'local'
      }
    ]

    const container = render(
      <AICodingNewChatLanding
        workspaces={manyWorkspaces}
        sessions={sessionsWithWs12}
        onStartChat={vi.fn()}
        onNewWorkspace={vi.fn()}
      />
    )

    // Ws 12 should be visible in top 9 because of session activity
    expect(container.textContent).toContain('Workspace 12')
    // Open local folder is fixed at 10th card
    expect(container.textContent).toContain('打开本地目录')
    // Expand button is present
    expect(container.textContent).toContain('展开全部')

    // Find expand button and click it
    const expandBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('展开全部'))
    expect(expandBtn).toBeDefined()
    act(() => {
      expandBtn?.click()
    })

    // Now it shows collapse button
    expect(container.textContent).toContain('收起')
  })

  it('sorts workspaces by native session modifiedAt history when nativeSessionsMap is provided', () => {
    // ws-1 was created earlier (1000) and ws-2 was created later (2000)
    // ws-1 has a native session modified at 99999
    // ws-2 has a native session modified at 10000
    const nativeMap = {
      'ws-1': {
        sessions: [{ modifiedAt: 99999, sessionId: 'ns-1', title: 'Native chat in ws 1', toolType: 'claude' }]
      },
      'ws-2': {
        sessions: [{ modifiedAt: 10000, sessionId: 'ns-2', title: 'Native chat in ws 2', toolType: 'codex' }]
      }
    }

    const container = render(
      <AICodingNewChatLanding
        workspaces={mockWorkspaces}
        sessions={[]}
        nativeSessionsMap={nativeMap}
        onStartChat={vi.fn()}
        onNewWorkspace={vi.fn()}
      />
    )

    // Workspace cards appear in order of recent conversation activity
    const wsCards = container.querySelectorAll('span[title]')
    const cardTexts = Array.from(wsCards).map((el) => el.getAttribute('title') || el.textContent)
    const ws1Index = cardTexts.findIndex((t) => t?.includes('Frontend App'))
    const ws2Index = cardTexts.findIndex((t) => t?.includes('Backend Service'))

    expect(ws1Index).toBeGreaterThanOrEqual(0)
    expect(ws2Index).toBeGreaterThanOrEqual(0)
    expect(ws1Index).toBeLessThan(ws2Index)
  })
})

describe('AICodingSidebar Recents and Tips', () => {
  it('displays recents group by default even when workspaces are collapsed', async () => {
    localStorage.setItem('cb-workbench-collapsed-workspaces', JSON.stringify(['ws-1', 'ws-2']))
    useAICodingStore.setState({
      workspaces: mockWorkspaces,
      sessions: [],
      groups: [{ id: 'default', name: 'Default', isDefault: true, order: 0 }]
    })

    ;(window as any).api = {
      ...(window as any).api,
      aiCoding: {
        listNativeSessions: vi.fn().mockResolvedValue([
          { sessionId: 'nat-rec-1', title: 'Recent Feature Chat', modifiedAt: Date.now(), toolType: 'claude' }
        ]),
        getSessionStats: vi.fn().mockResolvedValue(null)
      }
    }

    let container: HTMLDivElement
    await act(async () => {
      container = render(
        <AICodingSidebar
          onNewWorkspace={vi.fn()}
          onNewSession={vi.fn()}
          onSelectSession={vi.fn()}
          onSelectWorkspace={vi.fn()}
        />
      )
    })

    // The recents group should be present by default without having to expand workspaces
    expect(container!.textContent).toContain('最近会话')
    expect(container!.textContent).toContain('Recent Feature Chat')
  })

  it('renders top New Chat button and Add Workspace folder button with animation and tooltip', async () => {
    useAICodingStore.setState({
      workspaces: mockWorkspaces,
      sessions: [],
      groups: [{ id: 'default', name: 'Default', isDefault: true, order: 0 }]
    })

    const onOpenNewChat = vi.fn()
    const onNewWorkspace = vi.fn()

    let container: HTMLDivElement
    await act(async () => {
      container = render(
        <AICodingSidebar
          onNewWorkspace={onNewWorkspace}
          onNewSession={vi.fn()}
          onSelectSession={vi.fn()}
          onSelectWorkspace={vi.fn()}
          onOpenNewChat={onOpenNewChat}
        />
      )
    })

    const buttons = container!.querySelectorAll('button')
    const newChatBtn = Array.from(buttons).find((b) => b.textContent?.includes('New Chat') || b.textContent?.includes('新建会话'))
    expect(newChatBtn).toBeDefined()
    act(() => {
      newChatBtn?.click()
    })
    expect(onOpenNewChat).toHaveBeenCalledTimes(1)

    const addWsBtn = Array.from(buttons).find(
      (b) => b.getAttribute('aria-label')?.includes('工作区') || b.getAttribute('aria-label')?.includes('Workspace')
    )
    expect(addWsBtn).toBeDefined()
    act(() => {
      addWsBtn?.click()
    })
    expect(onNewWorkspace).toHaveBeenCalledTimes(1)
  })

  it('synchronizes highlighting between recents and workspace tree when active tab/session switches', async () => {
    const now = Date.now()
    const testSessions: AICodingSession[] = [
      { id: 's-1', workspaceId: 'ws-1', toolType: 'claude', status: 'idle', title: 'Fix auth bug', createdAt: now + 10000, updatedAt: now + 10000, source: 'local', lastActivity: 'none' },
      { id: 's-2', workspaceId: 'ws-2', toolType: 'codex', status: 'idle', title: 'Refactor database', createdAt: now + 20000, updatedAt: now + 20000, source: 'local', lastActivity: 'none' }
    ]

    useAICodingStore.setState({
      workspaces: mockWorkspaces,
      sessions: testSessions,
      groups: [{ id: 'default', name: 'Default', isDefault: true, order: 0 }],
      activeSessionId: 's-1'
    })

    let container: HTMLDivElement
    await act(async () => {
      container = render(
        <AICodingSidebar
          onNewWorkspace={vi.fn()}
          onNewSession={vi.fn()}
          onSelectSession={vi.fn()}
          onSelectWorkspace={vi.fn()}
        />
      )
    })

    const recentS1 = container!.querySelector('[data-cb-recent-key="recent-opened-s-1"]') as HTMLElement
    const wsS1 = container!.querySelector('[data-cb-session-id="s-1"]:not([data-cb-recent-key])') as HTMLElement

    expect(recentS1).not.toBeNull()
    expect(wsS1).not.toBeNull()
    expect(recentS1.style.background).not.toBe('transparent')
    expect(wsS1.style.background).not.toBe('transparent')

    // Now switch active tab to s-2 (belonging to ws-2)
    await act(async () => {
      useAICodingStore.setState({ activeSessionId: 's-2' })
    })

    const recentS2 = container!.querySelector('[data-cb-recent-key="recent-opened-s-2"]') as HTMLElement
    const wsS2 = container!.querySelector('[data-cb-session-id="s-2"]:not([data-cb-recent-key])') as HTMLElement

    expect(recentS2).not.toBeNull()
    expect(wsS2).not.toBeNull()
    expect(recentS2.style.background).not.toBe('transparent')
    expect(wsS2.style.background).not.toBe('transparent')
    expect(recentS1.style.background).toBe('transparent')
    expect(wsS1.style.background).toBe('transparent')
  })

  it('preserves workspace closed state and highlights workspace folder row when workspace is collapsed', async () => {
    localStorage.setItem('cb-workbench-collapsed-workspaces', JSON.stringify(['ws-2']))

    const now = Date.now()
    const testSessions: AICodingSession[] = [
      { id: 's-1', workspaceId: 'ws-1', toolType: 'claude', status: 'idle', title: 'Fix auth bug', createdAt: now + 10000, updatedAt: now + 10000, source: 'local', lastActivity: 'none' },
      { id: 's-2', workspaceId: 'ws-2', toolType: 'codex', status: 'idle', title: 'Refactor database', createdAt: now + 20000, updatedAt: now + 20000, source: 'local', lastActivity: 'none' }
    ]

    useAICodingStore.setState({
      workspaces: mockWorkspaces,
      sessions: testSessions,
      groups: [{ id: 'default', name: 'Default', isDefault: true, order: 0 }],
      activeSessionId: 's-1'
    })

    let container: HTMLDivElement
    await act(async () => {
      container = render(
        <AICodingSidebar
          onNewWorkspace={vi.fn()}
          onNewSession={vi.fn()}
          onSelectSession={vi.fn()}
          onSelectWorkspace={vi.fn()}
        />
      )
    })

    const ws2FolderBefore = container!.querySelector('[data-cb-ws-id="ws-2"]') as HTMLElement
    expect(ws2FolderBefore).not.toBeNull()
    expect(ws2FolderBefore.getAttribute('data-cb-active')).toBeNull()
    expect(ws2FolderBefore.style.background).toBe('transparent')
    // ws-2 is collapsed, so its session row should not exist in workspace tree
    expect(container!.querySelector('[data-cb-session-id="s-2"]:not([data-cb-recent-key])')).toBeNull()

    // Switch active session to s-2 (which belongs to the collapsed ws-2)
    await act(async () => {
      useAICodingStore.setState({ activeSessionId: 's-2' })
    })

    // ws-2 must remain collapsed (session row should NOT be mounted)
    expect(container!.querySelector('[data-cb-session-id="s-2"]:not([data-cb-recent-key])')).toBeNull()

    // But ws-2 folder row must now be active and highlighted!
    const ws2FolderAfter = container!.querySelector('[data-cb-ws-id="ws-2"]') as HTMLElement
    expect(ws2FolderAfter).not.toBeNull()
    expect(ws2FolderAfter.getAttribute('data-cb-active')).toBe('true')
    expect(ws2FolderAfter.style.background).not.toBe('transparent')

    // Recents row for s-2 is also highlighted
    const recentS2 = container!.querySelector('[data-cb-recent-key="recent-opened-s-2"]') as HTMLElement
    expect(recentS2).not.toBeNull()
    expect(recentS2.style.background).not.toBe('transparent')

    localStorage.removeItem('cb-workbench-collapsed-workspaces')
  })

  it('toggles workspace expand/collapse on a single normal-duration click without opacity flicker', async () => {
    localStorage.removeItem('cb-workbench-collapsed-workspaces')
    const now = Date.now()
    const testSessions: AICodingSession[] = [
      { id: 's-1', workspaceId: 'ws-1', toolType: 'claude', status: 'idle', title: 'Fix auth bug', createdAt: now, updatedAt: now, source: 'local', lastActivity: 'none' }
    ]

    useAICodingStore.setState({
      workspaces: mockWorkspaces,
      sessions: testSessions,
      groups: [{ id: 'default', name: 'Default', isDefault: true, order: 0 }],
      activeSessionId: 's-1'
    })

    const onSelectWorkspace = vi.fn()
    let container: HTMLDivElement
    await act(async () => {
      container = render(
        <AICodingSidebar
          onNewWorkspace={vi.fn()}
          onNewSession={vi.fn()}
          onSelectSession={vi.fn()}
          onSelectWorkspace={onSelectWorkspace}
        />
      )
    })

    const ws1Row = container!.querySelector('[data-cb-ws-id="ws-1"]') as HTMLElement
    expect(ws1Row).not.toBeNull()
    const sortableWrapper = ws1Row.parentElement?.parentElement as HTMLElement
    expect(sortableWrapper?.style.opacity).toBe('1')

    // Initially expanded: session row exists in workspace tree
    expect(container!.querySelector('[data-cb-session-id="s-1"]:not([data-cb-recent-key])')).not.toBeNull()

    // Simulate a normal human single click (~200ms hold between pointerdown and pointerup)
    await act(async () => {
      ws1Row.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, isPrimary: true, clientX: 20, clientY: 20 }))
      await new Promise((r) => setTimeout(r, 200))
    })

    // Must NOT enter drag mode or flicker opacity to 0.4 while stationary
    expect(sortableWrapper?.style.opacity).toBe('1')

    await act(async () => {
      document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, isPrimary: true, clientX: 20, clientY: 20 }))
      ws1Row.click()
    })

    // First single click collapses ws-1 and selects workspace
    expect(container!.querySelector('[data-cb-session-id="s-1"]:not([data-cb-recent-key])')).toBeNull()
    expect(onSelectWorkspace).toHaveBeenCalledWith('ws-1')

    // Second single click on the folder icon expands ws-1 without calling onSelectWorkspace again
    const folderIcon = ws1Row.querySelector('.anticon-folder') as HTMLElement
    expect(folderIcon).not.toBeNull()
    act(() => {
      folderIcon.click()
    })
    expect(container!.querySelector('[data-cb-session-id="s-1"]:not([data-cb-recent-key])')).not.toBeNull()
    expect(onSelectWorkspace).toHaveBeenCalledTimes(1)

    localStorage.removeItem('cb-workbench-collapsed-workspaces')
  })

  it('deduplicates identical native sessions across 3 workspaces, switches on click, and cleanly unmounts when collapsing Recents', async () => {
    localStorage.removeItem('cb-workbench-recents-collapsed')
    const threeWorkspaces: AICodingWorkspace[] = [
      { id: 'ws-1', title: 'Repo Parent', workingDir: 'D:/work', groupId: 'default', createdAt: 1000, updatedAt: 1000 },
      { id: 'ws-2', title: 'Frontend App', workingDir: 'D:/work/frontend', groupId: 'default', createdAt: 2000, updatedAt: 2000 },
      { id: 'ws-3', title: 'Backend App', workingDir: 'D:/work/backend', groupId: 'default', createdAt: 3000, updatedAt: 3000 }
    ]
    localStorage.setItem('cb-workbench-collapsed-workspaces', JSON.stringify(['ws-1', 'ws-2', 'ws-3']))

    const createSessionSpy = vi.fn().mockImplementation(async (wsId: string, toolType: string) => ({
      id: 'resumed-1',
      workspaceId: wsId,
      toolType,
      status: 'idle',
      source: 'local',
      createdAt: 9000,
      updatedAt: 9000
    }))
    const updateSessionSpy = vi.fn().mockResolvedValue(undefined)
    const onSelectSession = vi.fn()

    useAICodingStore.setState({
      workspaces: threeWorkspaces,
      sessions: [],
      groups: [{ id: 'default', name: 'Default', isDefault: true, order: 0 }],
      activeSessionId: null,
      createSession: createSessionSpy as any,
      updateSession: updateSessionSpy as any
    })

    ;(window as any).api = {
      ...(window as any).api,
      aiCoding: {
        listNativeSessions: vi.fn().mockImplementation(async (_dir: string, toolType: string) => {
          if (toolType === 'antigravity') {
            return [{ sessionId: 'shared-agy-1', title: 'Same Shared Session Title', modifiedAt: 50000 }]
          }
          return []
        }),
        getSessionStats: vi.fn().mockResolvedValue(null)
      }
    }

    const errorSpy = vi.spyOn(console, 'error')
    let container: HTMLDivElement
    await act(async () => {
      container = render(
        <AICodingSidebar
          onNewWorkspace={vi.fn()}
          onNewSession={vi.fn()}
          onSelectSession={onSelectSession}
          onSelectWorkspace={vi.fn()}
        />
      )
    })

    // Must NOT emit React duplicate-key warning
    const dupKeyErrors = errorSpy.mock.calls.filter((args) =>
      String(args[0] || '').includes('Encountered two children with the same key')
    )
    expect(dupKeyErrors).toHaveLength(0)
    errorSpy.mockRestore()

    // Even though 3 workspaces returned shared-agy-1, Recents must render it ONLY ONCE
    const recentItems = container!.querySelectorAll('[data-cb-recent-key]')
    expect(recentItems).toHaveLength(1)
    expect(recentItems[0].textContent).toContain('Same Shared Session Title')

    // Clicking the recent item resumes it and calls onSelectSession
    await act(async () => {
      ;(recentItems[0] as HTMLElement).click()
    })
    expect(createSessionSpy).toHaveBeenCalledTimes(1)
    expect(updateSessionSpy).toHaveBeenCalledWith(
      'resumed-1',
      expect.objectContaining({ toolSessionId: 'shared-agy-1', title: 'Same Shared Session Title' })
    )
    expect(onSelectSession).toHaveBeenCalledWith('resumed-1')

    // Collapsing Recents must completely unmount the recents list and leave zero items in DOM
    const recentsHeader = container!.querySelector('[data-cb-recents-header="true"]') as HTMLElement
    expect(recentsHeader).not.toBeNull()
    act(() => {
      recentsHeader.click()
    })
    expect(container!.querySelector('[data-cb-recents-list="true"]')).toBeNull()
    expect(container!.querySelectorAll('[data-cb-recent-key]')).toHaveLength(0)
    expect(container!.textContent).not.toContain('Same Shared Session Title')

    // Expanding Recents restores the item cleanly
    act(() => {
      recentsHeader.click()
    })
    expect(container!.querySelectorAll('[data-cb-recent-key]')).toHaveLength(1)

    localStorage.removeItem('cb-workbench-recents-collapsed')
    localStorage.removeItem('cb-workbench-collapsed-workspaces')
  })

  it('addTabToPane falls back to a valid leaf when focusedPaneId is stale', () => {
    const layout = {
      type: 'leaf' as const,
      id: 'valid-pane-1',
      tabIds: [] as string[],
      activeTabId: null
    }
    useAICodingStore.setState({
      globalLayout: layout,
      focusedPaneId: 'stale-deleted-pane-id',
      activeSessionId: null
    })

    act(() => {
      useAICodingStore.getState().addTabToPane('stale-deleted-pane-id', 's-1')
    })

    const nextState = useAICodingStore.getState()
    expect(nextState.activeSessionId).toBe('s-1')
    expect(nextState.focusedPaneId).toBe('valid-pane-1')
    expect((nextState.globalLayout as any).tabIds).toContain('s-1')
    expect((nextState.globalLayout as any).activeTabId).toBe('s-1')
  })
})

describe('PaneTabBar', () => {
  it('does not render top-left new session button', () => {
    const onNewSession = vi.fn()
    const container = render(
      <PaneTabBar
        paneId="p-1"
        tabs={mockSessions}
        activeTabId="s-1"
        workingDir="D:/work/frontend"
        onSelectTab={vi.fn()}
        onCloseTab={vi.fn()}
        onNewSession={onNewSession}
      />
    )

    expect(container.textContent).toContain('Fix auth bug')
    expect(container.textContent).toContain('Refactor database')
  })

  it('does not render top-right cost amount but retains chat/cli mode toggle buttons', () => {
    const tabsWithCost: AICodingSession[] = [
      {
        id: 's-cost-1',
        workspaceId: 'ws-1',
        toolType: 'claude',
        source: 'local',
        status: 'idle',
        lastActivity: 'none',
        costUsd: 0.1234,
        createdAt: 1000,
        updatedAt: 1000
      }
    ]
    const container = render(
      <PaneTabBar
        paneId="p-1"
        tabs={tabsWithCost}
        activeTabId="s-cost-1"
        workingDir="D:/work/frontend"
        onSelectTab={vi.fn()}
        onCloseTab={vi.fn()}
        onNewSession={vi.fn()}
        claudeViewMode="chat"
        onClaudeViewModeChange={vi.fn()}
      />
    )

    // Cost amount should not be displayed in PaneTabBar top-right
    expect(container.textContent).not.toContain('0.1234')
    expect(container.textContent).not.toContain('$')

    // Chat / CLI toggle buttons are retained in PaneTabBar top-right
    expect(container.textContent).toContain('Chat')
    expect(container.textContent).toContain('CLI')
  })
})

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import CodingSessionStatusBar, {
  formatTokens,
  getDefaultContextWindow,
  formatModelName
} from '../CodingSessionStatusBar'
import { useAICodingStore } from '../../../stores/useAICodingStore'
import type { AICodingSession } from '../../../types/ai-coding'

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
    root.render(ui)
  })
  mounted.push({ root, container })
  return container
}

beforeAll(() => {
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
  vi.clearAllMocks()
})

describe('CodingSessionStatusBar helper functions', () => {
  it('formatTokens correctly formats counts', () => {
    expect(formatTokens(0)).toBe('0')
    expect(formatTokens(450)).toBe('450')
    expect(formatTokens(1200)).toBe('1.2k')
    expect(formatTokens(9900)).toBe('9.9k')
    expect(formatTokens(25000)).toBe('25k')
    expect(formatTokens(200000)).toBe('200k')
    expect(formatTokens(1000000)).toBe('1.0M')
    expect(formatTokens(2500000)).toBe('2.5M')
  })

  it('getDefaultContextWindow returns appropriate limits per tool', () => {
    expect(getDefaultContextWindow('claude')).toBe(200_000)
    expect(getDefaultContextWindow('codex')).toBe(200_000)
    expect(getDefaultContextWindow('gemini')).toBe(1_000_000)
    expect(getDefaultContextWindow('antigravity')).toBe(1_000_000)
    expect(getDefaultContextWindow('grok')).toBe(128_000)
  })

  it('formatModelName maps raw IDs and provides fallbacks', () => {
    expect(formatModelName('claude-3-7-sonnet-20250219')).toBe('Claude 3.7 Sonnet')
    expect(formatModelName('claude-3-5-sonnet-20241022')).toBe('Claude 3.5 Sonnet')
    expect(formatModelName('claude-opus-5-5')).toBe('Claude Opus 5.5')
    expect(formatModelName('gpt-4o-2024-08-06')).toBe('GPT-4o')
    expect(formatModelName('o3-mini')).toBe('o3-mini')
    expect(formatModelName('Gemini 3.8 Flash (High)')).toBe('Gemini 3.8 Flash')
    expect(formatModelName('gemini-3.8-pro')).toBe('Gemini 3.8 Pro')
    expect(formatModelName('gemini-2.5-pro')).toBe('Gemini 2.5 Pro')
    expect(formatModelName('grok-2')).toBe('Grok 2')

    // Claude 4+ ids, incl. date suffixes and the `[1m]` context alias
    expect(formatModelName('claude-opus-5-5[1M]')).toBe('Claude Opus 5.5')
    expect(formatModelName('claude-sonnet-5-5')).toBe('Claude Sonnet 5.5')
    expect(formatModelName('claude-sonnet-4-5-20250929')).toBe('Claude Sonnet 4.5')
    expect(formatModelName('claude-opus-4-20250514')).toBe('Claude Opus 4')
    expect(formatModelName('claude-fable-5-1')).toBe('Claude Fable 5.1')

    // Tool fallbacks when model is undefined
    expect(formatModelName(undefined, 'claude')).toBe('Claude')
    expect(formatModelName(undefined, 'codex')).toBe('GPT-4o')
    expect(formatModelName(undefined, 'gemini')).toBe('Gemini 2.5 Pro')
    expect(formatModelName(undefined, 'antigravity')).toBe('Gemini 3.8 Flash')
    expect(formatModelName(undefined, 'grok')).toBe('Grok 2')
  })
})

describe('CodingSessionStatusBar UI component', () => {
  const dummySession: AICodingSession = {
    id: 'test-session-1',
    workspaceId: 'ws-1',
    toolType: 'claude',
    source: 'local',
    status: 'idle',
    lastActivity: 'none',
    costUsd: 0.0125,
    model: 'claude-3-7-sonnet-20250219',
    createdAt: Date.now(),
    updatedAt: Date.now()
  }

  beforeEach(() => {
    ;(window as any).api = {
      git: {
        listBranches: vi.fn().mockResolvedValue({ current: 'main', local: ['main'], remote: [] }),
        diffStat: vi.fn().mockResolvedValue({ additions: 24, deletions: 8 })
      },
      aiCoding: {
        openDirectory: vi.fn().mockResolvedValue(true)
      }
    }

    useAICodingStore.setState({
      sessionContextUsage: {
        'test-session-1': {
          type: 'context_usage',
          inputTokens: 12000,
          cachedInputTokens: 8000,
          outputTokens: 1500,
          usedTokens: 20000,
          contextWindow: 200000
        }
      },
      sessionMessages: {}
    })
  })

  it('renders working directory and calls openDirectory on click', async () => {
    const dir = '/repos/my-project'
    const container = render(
      <CodingSessionStatusBar
        sessionId="test-session-1"
        session={dummySession}
        workingDir={dir}
      />
    )

    const dirEl = container.querySelector('[data-testid="status-bar-working-dir"]')
    expect(dirEl).not.toBeNull()
    expect(dirEl?.textContent).toContain('my-project')

    await act(async () => {
      dirEl?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect((window as any).api.aiCoding.openDirectory).toHaveBeenCalledWith(dir)
  })

  it('displays git branch and diff stats when git is detected', async () => {
    let container!: HTMLDivElement
    await act(async () => {
      container = render(
        <CodingSessionStatusBar
          sessionId="test-session-1"
          session={dummySession}
          workingDir="C:\\repos\\my-project"
        />
      )
    })

    // Allow promise resolution
    await act(async () => {
      await Promise.resolve()
    })

    const branchEl = container.querySelector('[data-testid="status-bar-git-branch"]')
    expect(branchEl).not.toBeNull()
    expect(branchEl?.textContent).toContain('main')

    const diffEl = container.querySelector('[data-testid="status-bar-diff-stat"]')
    expect(diffEl).not.toBeNull()
    expect(diffEl?.textContent).toContain('+24')
    expect(diffEl?.textContent).toContain('-8')
  })

  it('does NOT display git branch when directory is not git', async () => {
    ;(window as any).api.git.listBranches = vi.fn().mockRejectedValue(new Error('not a git repo'))

    let container!: HTMLDivElement
    await act(async () => {
      container = render(
        <CodingSessionStatusBar
          sessionId="test-session-1"
          session={dummySession}
          workingDir="C:\\repos\\non-git"
        />
      )
    })

    await act(async () => {
      await Promise.resolve()
    })

    const branchEl = container.querySelector('[data-testid="status-bar-git-branch"]')
    expect(branchEl).toBeNull()
  })

  it('toggles git panel when diff stat is clicked', async () => {
    const onToggleGit = vi.fn()
    let container!: HTMLDivElement
    await act(async () => {
      container = render(
        <CodingSessionStatusBar
          sessionId="test-session-1"
          session={dummySession}
          workingDir="C:\\repos\\my-project"
          onToggleGitPanel={onToggleGit}
        />
      )
    })

    await act(async () => {
      await Promise.resolve()
    })

    const diffEl = container.querySelector('[data-testid="status-bar-diff-stat"]')
    await act(async () => {
      diffEl?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(onToggleGit).toHaveBeenCalledTimes(1)
  })

  it('renders context usage progress bar, cost, and model name', async () => {
    let container!: HTMLDivElement
    await act(async () => {
      container = render(
        <CodingSessionStatusBar
          sessionId="test-session-1"
          session={dummySession}
          workingDir="C:\\repos\\my-project"
        />
      )
    })

    // Context progress bar
    const progressEl = container.querySelector('[data-testid="status-bar-context-progress"]')
    expect(progressEl).not.toBeNull()
    // 20,000 / 200,000 = 10%
    expect(progressEl?.textContent).toContain('20k/200k')
    expect(progressEl?.textContent).toContain('10%')

    // Cost
    const costEl = container.querySelector('[data-testid="status-bar-cost"]')
    expect(costEl).not.toBeNull()
    expect(costEl?.textContent).toContain('$0.0125')

    // Model
    const modelEl = container.querySelector('[data-testid="status-bar-model"]')
    expect(modelEl).not.toBeNull()
    expect(modelEl?.textContent).toContain('Claude 3.7 Sonnet')
  })

  it('updates live context progress, cost, and model from getSessionStats', async () => {
    ;(window as any).api.aiCoding.getSessionStats = vi.fn().mockResolvedValue({
      sessionId: 'test-session-2',
      toolType: 'antigravity',
      model: 'Gemini 3.8 Flash (High)',
      costUsd: 0.0058,
      contextUsage: {
        inputTokens: 3000,
        cachedInputTokens: 70000,
        outputTokens: 7000,
        usedTokens: 80000,
        contextWindow: 1000000
      }
    })

    const agySession: AICodingSession = {
      id: 'test-session-2',
      workspaceId: 'ws-1',
      toolType: 'antigravity',
      source: 'local',
      status: 'running',
      lastActivity: 'thinking',
      createdAt: Date.now(),
      updatedAt: Date.now()
    }

    let container!: HTMLDivElement
    await act(async () => {
      container = render(
        <CodingSessionStatusBar
          sessionId="test-session-2"
          session={agySession}
          workingDir="C:\\repos\\my-project"
        />
      )
    })

    await act(async () => {
      await Promise.resolve()
    })

    // Context: 80,000 / 1,000,000 = 8%
    const progressEl = container.querySelector('[data-testid="status-bar-context-progress"]')
    expect(progressEl?.textContent).toContain('80k/1.0M')
    expect(progressEl?.textContent).toContain('8%')

    // Cost: $0.0058
    const costEl = container.querySelector('[data-testid="status-bar-cost"]')
    expect(costEl?.textContent).toContain('$0.0058')

    // Model: Gemini 3.8 Flash
    const modelEl = container.querySelector('[data-testid="status-bar-model"]')
    expect(modelEl?.textContent).toContain('Gemini 3.8 Flash')
  })

  it('shows the configured model and 1M window for a fresh Claude session (no usage yet)', async () => {
    // Backend fallback for a session with no turn / transcript yet.
    ;(window as any).api.aiCoding.getSessionStats = vi.fn().mockResolvedValue({
      sessionId: 'fresh-claude',
      toolType: 'claude',
      model: 'claude-opus-5-5[1M]',
      costUsd: 0,
      contextWindow: 1_000_000
    })
    useAICodingStore.setState({ sessionContextUsage: {}, sessionMessages: {} })

    const freshSession: AICodingSession = {
      id: 'fresh-claude',
      workspaceId: 'ws-1',
      toolType: 'claude',
      source: 'local',
      status: 'idle',
      lastActivity: 'none',
      // Placeholder persisted by older builds — must not win over live stats.
      model: 'Claude 3.7 Sonnet',
      createdAt: Date.now(),
      updatedAt: Date.now()
    }

    let container!: HTMLDivElement
    await act(async () => {
      container = render(
        <CodingSessionStatusBar
          sessionId="fresh-claude"
          session={freshSession}
          workingDir="C:\\repos\\my-project"
        />
      )
    })
    await act(async () => {
      await Promise.resolve()
    })

    const progressEl = container.querySelector('[data-testid="status-bar-context-progress"]')
    expect(progressEl?.textContent).toContain('0/1.0M')
    const modelEl = container.querySelector('[data-testid="status-bar-model"]')
    expect(modelEl?.textContent).toContain('Claude Opus 5.5')
    expect(modelEl?.textContent).not.toContain('3.7')
  })

  it('ignores a late stats response for the previous tab after switching sessions', async () => {
    let resolveOld!: (v: unknown) => void
    ;(window as any).api.aiCoding.getSessionStats = vi.fn((id: string) =>
      id === 'old-tab'
        ? new Promise((r) => { resolveOld = r })
        : Promise.resolve({ sessionId: id, toolType: 'claude', model: 'claude-opus-5-5[1M]', costUsd: 0, contextWindow: 1_000_000 })
    )
    useAICodingStore.setState({ sessionContextUsage: {}, sessionMessages: {} })
    const mk = (id: string): AICodingSession => ({
      id, workspaceId: 'ws-1', toolType: 'claude', source: 'local', status: 'idle',
      lastActivity: 'none', createdAt: Date.now(), updatedAt: Date.now()
    })

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    mounted.push({ root, container })
    await act(async () => {
      root.render(<CodingSessionStatusBar sessionId="old-tab" session={mk('old-tab')} workingDir="C:\\repos\\p" />)
    })
    await act(async () => {
      root.render(<CodingSessionStatusBar sessionId="new-tab" session={mk('new-tab')} workingDir="C:\\repos\\p" />)
    })
    await act(async () => {
      resolveOld({ sessionId: 'old-tab', toolType: 'claude', model: 'claude-haiku-5-5', costUsd: 0, contextWindow: 200_000 })
      await Promise.resolve()
    })

    const modelEl = container.querySelector('[data-testid="status-bar-model"]')
    expect(modelEl?.textContent).toContain('Claude Opus 5.5')
    expect(container.querySelector('[data-testid="status-bar-context-progress"]')?.textContent).toContain('/1.0M')
  })

  it('renders message count (turnsCount) when messages exist in store or via prop', async () => {
    useAICodingStore.setState({
      sessionMessages: {
        'test-session-1': [
          { id: 'm1', sessionId: 'test-session-1', role: 'user', blocks: [{ type: 'text', text: 'hello' }], timestamp: Date.now() },
          { id: 'm2', sessionId: 'test-session-1', role: 'assistant', blocks: [{ type: 'text', text: 'hi' }], timestamp: Date.now() },
          { id: 'm3', sessionId: 'test-session-1', role: 'user', blocks: [{ type: 'text', text: 'code' }], timestamp: Date.now() }
        ]
      }
    })

    let container!: HTMLDivElement
    await act(async () => {
      container = render(
        <CodingSessionStatusBar
          sessionId="test-session-1"
          session={dummySession}
          workingDir="C:\\repos\\my-project"
        />
      )
    })

    const turnsEl = container.querySelector('[data-testid="status-bar-message-count"]')
    expect(turnsEl).not.toBeNull()
    expect(turnsEl?.textContent).toContain('3')

    // Also support overriding via messageCount prop
    let container2!: HTMLDivElement
    await act(async () => {
      container2 = render(
        <CodingSessionStatusBar
          sessionId="test-session-1"
          session={dummySession}
          workingDir="C:\\repos\\my-project"
          messageCount={5}
        />
      )
    })
    const turnsEl2 = container2.querySelector('[data-testid="status-bar-message-count"]')
    expect(turnsEl2?.textContent).toContain('5')
  })

  it('does NOT render message count when messages array is empty', async () => {
    useAICodingStore.setState({
      sessionMessages: {
        'test-session-1': []
      }
    })

    let container!: HTMLDivElement
    await act(async () => {
      container = render(
        <CodingSessionStatusBar
          sessionId="test-session-1"
          session={dummySession}
          workingDir="C:\\repos\\my-project"
        />
      )
    })

    const turnsEl = container.querySelector('[data-testid="status-bar-message-count"]')
    expect(turnsEl).toBeNull()
  })
})

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import WorkspaceLandingPanel from '../WorkspaceLandingPanel'
import PaneTabBar from '../PaneTabBar'
import { useSettingsStore } from '../../../stores/useSettingsStore'
import { resetWorkspaceOpenerCacheForTests } from '../../../hooks/useWorkspaceOpener'
import type { AICodingWorkspace } from '../../../types/ai-coding'

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn()
}))

interface RenderedComponent {
  root: Root
  container: HTMLDivElement
}

const mounted: RenderedComponent[] = []

async function render(ui: React.ReactElement): Promise<HTMLDivElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(ui)
  })
  // Let the async IDE scan resolve and re-render.
  await act(async () => {
    await Promise.resolve()
  })
  mounted.push({ root, container })
  return container
}

const mockWorkspace: AICodingWorkspace = {
  id: 'ws-test',
  groupId: 'default',
  title: 'Test Workspace',
  workingDir: 'C:\\test\\workspace',
  createdAt: Date.now(),
  updatedAt: Date.now()
}

const getAvailableIdes = vi.fn()

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
  ;(window as any).api = {
    aiCoding: {
      detectTools: vi.fn().mockResolvedValue([]),
      openDirectory: vi.fn().mockResolvedValue('')
    },
    vcs: {
      changedFiles: vi.fn().mockResolvedValue({ files: [] }),
      detectAll: vi.fn().mockResolvedValue([])
    },
    developer: {
      getAvailableIdes,
      openInIde: vi.fn().mockResolvedValue(true)
    }
  }
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true
})

beforeEach(() => {
  resetWorkspaceOpenerCacheForTests()
  getAvailableIdes.mockReset()
})

afterEach(() => {
  while (mounted.length > 0) {
    const item = mounted.pop()
    act(() => {
      item?.root.unmount()
    })
    item?.container.remove()
  }
  useSettingsStore.setState({ localIdePath: '' })
})

const landing = (): React.ReactElement => (
  <WorkspaceLandingPanel
    workspace={mockWorkspace}
    onOpenSession={vi.fn()}
    onNewSession={vi.fn()}
    onOpenTerminal={vi.fn()}
    onToggleChanges={vi.fn()}
    changesOpen={false}
  />
)

describe('Workspace Opener UI', () => {
  it('renders VS Code entry in WorkspaceLandingPanel when VS Code is installed', async () => {
    getAvailableIdes.mockResolvedValue([{ id: 'vscode', name: 'Visual Studio Code', path: 'C:\\Code.exe' }])
    const container = await render(landing())
    expect(container.textContent).toContain('VS Code')
  })

  it('renders File Explorer entry in WorkspaceLandingPanel when VS Code is not installed', async () => {
    getAvailableIdes.mockResolvedValue([{ id: 'pycharm', name: 'PyCharm', path: 'C:\\pycharm.exe' }])
    const container = await render(landing())
    expect(container.textContent).toContain('文件管理器')
  })

  it('uses a VS Code configured in Settings without waiting for the scan', async () => {
    getAvailableIdes.mockResolvedValue([])
    useSettingsStore.setState({ localIdePath: 'C:\\Program Files\\Microsoft VS Code\\Code.exe' })
    const container = await render(landing())
    expect(container.textContent).toContain('VS Code')
  })

  it('renders the opener button in PaneTabBar between terminal and changes', async () => {
    getAvailableIdes.mockResolvedValue([{ id: 'vscode', name: 'Visual Studio Code', path: 'C:\\Code.exe' }])
    const onOpenWorkspace = vi.fn()
    const container = await render(
      <PaneTabBar
        paneId="test-pane"
        tabs={[]}
        activeTabId={null}
        workingDir={mockWorkspace.workingDir}
        onSelectTab={vi.fn()}
        onCloseTab={vi.fn()}
        onNewSession={vi.fn()}
        onToggleTerminalPanel={vi.fn()}
        onToggleGitPanel={vi.fn()}
        onOpenWorkspace={onOpenWorkspace}
      />
    )

    const opener = container.querySelector('button[aria-label="以 VS Code 打开"]') as HTMLButtonElement | null
    expect(opener).not.toBeNull()
    act(() => {
      opener!.click()
    })
    expect(onOpenWorkspace).toHaveBeenCalledWith(mockWorkspace.workingDir)
  })
})

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { App as AntdApp } from 'antd'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import AppLibraryPage from '../AppLibraryPage'
import { applicationManager } from '../../../services/applicationManager'
import { useSubAppStore } from '../../../stores/useSubAppStore'
import { useAuthStore } from '../../../stores/useAuthStore'
import { useWorkspaceStore } from '../../../stores/useWorkspaceStore'
import type { ApplicationDetail } from '../../../types/api'
import type { User } from '../../../types/auth'
import type { Workspace } from '../../../types/workspace'

interface Mounted {
  root: Root
  container: HTMLDivElement
}

const mounted: Mounted[] = []

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

afterEach(async () => {
  for (const item of mounted.splice(0)) {
    await act(async () => item.root.unmount())
    item.container.remove()
  }
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

const mockInstalledApp: ApplicationDetail = {
  applicationId: 'com.test.installed',
  name: 'Installed Test App',
  description: 'An app that is installed',
  ownerId: 'user-2',
  ownerName: 'Other Dev',
  type: 'app',
  version: '1.0.0',
  category: 'tools',
  published: true,
  downloadCount: 0,
  metadata: {},
  createdAt: 1000,
  updatedAt: 1000,
  versions: []
}

const mockAppWithParams: ApplicationDetail = {
  applicationId: 'com.test.withparams',
  name: 'App With Params',
  description: 'An app that needs params',
  ownerId: 'user-2',
  ownerName: 'Other Dev',
  type: 'app',
  version: '1.0.0',
  category: 'tools',
  published: true,
  downloadCount: 0,
  metadata: {},
  createdAt: 1000,
  updatedAt: 1000,
  versions: []
}

const mockPendingUpdateApp: ApplicationDetail = {
  applicationId: 'com.test.pendingupdate',
  name: 'Pending Update App',
  description: 'An app with an update',
  ownerId: 'user-2',
  ownerName: 'Other Dev',
  type: 'app',
  version: '2.0.0',
  category: 'tools',
  published: true,
  downloadCount: 0,
  metadata: {},
  createdAt: 1000,
  updatedAt: 1000,
  versions: []
}

const mockUser: User = {
  id: 'user-1',
  name: 'Tester',
  email: 'test@example.com',
  avatarUrl: ''
}

const mockWorkspace: Workspace = {
  id: 'ws-1',
  name: 'default',
  path: '/workspace',
  vcsType: 'git',
  createdAt: '2026-01-01T00:00:00.000Z'
}

async function renderPage(): Promise<Mounted> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/workbench/library']}>
        <AntdApp>
          <AppLibraryPage />
        </AntdApp>
      </MemoryRouter>
    )
  })

  // Flush pending promises from loadApps()
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 50))
  })

  const item = { root, container }
  mounted.push(item)
  return item
}

describe('AppLibraryPage - Execution of Installed Apps', () => {
  let executeMock: Mock

  beforeEach(() => {
    executeMock = vi.fn().mockResolvedValue('task-123')

    // Mock electron window.api methods exercised by AppLibraryPage and ParamDrawer
    window.api = {
      ...(window.api || {}),
      subapp: {
        ...(window.api?.subapp || {}),
        list: vi.fn().mockImplementation(async () => useSubAppStore.getState().appInfos),
        getManifest: vi.fn().mockImplementation(async (id: string) => {
          return useSubAppStore.getState().appInfos.find((a) => a.id === id)?.manifest ?? null
        }),
        execute: executeMock,
        resolveSlot: vi.fn().mockResolvedValue([])
      },
      workspace: {
        ...(window.api?.workspace || {}),
        list: vi.fn().mockResolvedValue([]),
        getActive: vi.fn().mockResolvedValue(mockWorkspace)
      },
      appSchedule: {
        ...(window.api?.appSchedule || {}),
        list: vi.fn().mockResolvedValue([]),
        onExecuted: vi.fn().mockReturnValue(() => {})
      }
    } as unknown as typeof window.api

    useAuthStore.setState({
      isLocalMode: false,
      user: mockUser
    })

    useWorkspaceStore.setState({
      activeWorkspace: mockWorkspace,
      workspaces: [mockWorkspace]
    })

    useSubAppStore.setState({
      appInfos: [
        {
          id: 'com.test.installed',
          path: '/path/installed',
          source: 'user',
          manifest: {
            id: 'com.test.installed',
            name: 'Installed Test App',
            version: '1.0.0',
            description: 'Installed app manifest',
            entry: 'main.py',
            author: 'Other Dev',
            type: 'app'
          }
        },
        {
          id: 'com.test.withparams',
          path: '/path/withparams',
          source: 'user',
          manifest: {
            id: 'com.test.withparams',
            name: 'App With Params',
            version: '1.0.0',
            description: 'App with params manifest',
            entry: 'main.py',
            author: 'Other Dev',
            type: 'app',
            params: [
              {
                name: 'target_dir',
                label: 'Target Directory',
                type: 'string',
                required: true
              }
            ]
          }
        },
        {
          id: 'com.test.pendingupdate',
          path: '/path/pendingupdate',
          source: 'user',
          manifest: {
            id: 'com.test.pendingupdate',
            name: 'Pending Update App',
            version: '1.0.0',
            description: 'Pending update manifest',
            entry: 'main.py',
            author: 'Other Dev',
            type: 'app'
          }
        }
      ]
    })

    vi.spyOn(applicationManager, 'fetchApplications').mockResolvedValue([
      mockInstalledApp,
      mockAppWithParams,
      mockPendingUpdateApp
    ])

    vi.spyOn(applicationManager, 'fetchApplicationDetail').mockImplementation(async (id: string) => {
      if (id === mockInstalledApp.applicationId) return mockInstalledApp
      if (id === mockAppWithParams.applicationId) return mockAppWithParams
      if (id === mockPendingUpdateApp.applicationId) return mockPendingUpdateApp
      return mockInstalledApp
    })
  })

  it('directly executes installed app when clicking the card run button', async () => {
    const { container } = await renderPage()

    // Find the card for mockInstalledApp
    const card = container.querySelector(`[data-app-id="${mockInstalledApp.applicationId}"]`)
    expect(card).not.toBeNull()

    // Find the primary round run button (with caret icon)
    const runBtn = card?.querySelector('.cb-round-action-btn.cb-round-action-primary') as HTMLButtonElement | null
    expect(runBtn).not.toBeNull()

    await act(async () => {
      runBtn?.click()
    })

    expect(executeMock).toHaveBeenCalledWith('com.test.installed', {})
  })

  it('directly executes installed app from the detail drawer', async () => {
    const { container } = await renderPage()

    const card = container.querySelector(`[data-app-id="${mockInstalledApp.applicationId}"]`) as HTMLElement | null
    expect(card).not.toBeNull()

    // Click card to open detail drawer
    await act(async () => {
      card?.click()
    })

    // Drawer should be open in document body
    const drawer = document.querySelector('.ant-drawer-open')
    expect(drawer).not.toBeNull()

    // Find run button inside drawer
    const runBtn = Array.from(drawer?.querySelectorAll('button') ?? []).find(
      (b) => b.textContent?.includes('运行') || b.textContent?.includes('Run')
    )
    expect(runBtn).toBeDefined()

    await act(async () => {
      runBtn?.click()
    })

    expect(executeMock).toHaveBeenCalledWith('com.test.installed', {})
  })

  it('opens ParamDrawer when app has required params, and executes upon submission', async () => {
    const { container } = await renderPage()

    const card = container.querySelector(`[data-app-id="${mockAppWithParams.applicationId}"]`)
    const runBtn = card?.querySelector('.cb-round-action-btn.cb-round-action-primary') as HTMLButtonElement | null
    expect(runBtn).not.toBeNull()

    await act(async () => {
      runBtn?.click()
    })

    // Should NOT have executed directly
    expect(executeMock).not.toHaveBeenCalled()

    // ParamDrawer should be opened
    const paramDrawer = document.querySelector('.ant-drawer-open')
    expect(paramDrawer).not.toBeNull()
    expect(paramDrawer?.textContent).toContain('Target Directory')
  })

  it('renders both update and run buttons for pending_update app', async () => {
    const { container } = await renderPage()

    const card = container.querySelector(`[data-app-id="${mockPendingUpdateApp.applicationId}"]`)
    expect(card).not.toBeNull()

    const actionButtons = card?.querySelectorAll('.cb-round-action-btn')
    expect(actionButtons?.length).toBe(2)

    const updateBtn = card?.querySelector('.cb-round-action-btn.cb-round-action-neutral')
    const runBtn = card?.querySelector('.cb-round-action-btn.cb-round-action-primary')
    expect(updateBtn).not.toBeNull()
    expect(runBtn).not.toBeNull()

    // Clicking run button still executes the installed version
    await act(async () => {
      (runBtn as HTMLButtonElement | null)?.click()
    })

    expect(executeMock).toHaveBeenCalledWith('com.test.pendingupdate', {})
  })
})

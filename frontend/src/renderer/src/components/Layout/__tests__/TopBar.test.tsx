import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { App as AntdApp } from 'antd'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import TopBar from '../TopBar'
import { useAuthStore } from '../../../stores/useAuthStore'
import { useSettingsStore } from '../../../stores/useSettingsStore'
import { useUpdaterStore } from '../../../stores/useUpdaterStore'

vi.mock('../../ProjectSwitcher', () => ({ default: () => <span data-testid="project-switcher" /> }))
vi.mock('../../WorkspaceSwitcher', () => ({ default: () => <span data-testid="workspace-switcher" /> }))
vi.mock('../../GitBranchSelector', () => ({ default: () => null }))
vi.mock('../../../pages/AICoding/AICodingIMConfigModal', () => ({ default: () => null }))

interface Mounted {
  root: Root
  container: HTMLDivElement
}

const mounted: Mounted[] = []

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
  globalThis.ResizeObserver = class ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(async () => {
  for (const item of mounted.splice(0)) {
    await act(async () => item.root.unmount())
    item.container.remove()
  }
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

async function renderTopBar(): Promise<Mounted> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/workbench/installed']}>
        <AntdApp>
          <TopBar />
        </AntdApp>
      </MemoryRouter>
    )
  })
  const item = { root, container }
  mounted.push(item)
  return item
}

const buttonsIn = (el: Element): HTMLButtonElement[] => Array.from(el.querySelectorAll('button'))
const byText = (list: HTMLElement[], text: string): HTMLElement | undefined =>
  list.find((b) => b.textContent?.trim() === text)
const precedes = (a: Node, b: Node): boolean =>
  (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0

describe('TopBar layout & controls', () => {
  let settingsSet: ReturnType<typeof vi.fn>

  beforeEach(() => {
    settingsSet = vi.fn().mockResolvedValue(undefined)
    window.api = {
      ...(window.api || {}),
      platform: 'win32',
      windowControl: {
        minimize: vi.fn(),
        maximize: vi.fn(),
        close: vi.fn(),
        isMaximized: vi.fn().mockResolvedValue(false)
      },
      system: { getLocalIp: vi.fn().mockResolvedValue('127.0.0.1') },
      updater: {
        onChecking: vi.fn(() => () => {}),
        onAvailable: vi.fn(() => () => {}),
        onNotAvailable: vi.fn(() => () => {}),
        onProgress: vi.fn(() => () => {}),
        onDownloaded: vi.fn(() => () => {}),
        onError: vi.fn(() => () => {}),
        getStatus: vi.fn().mockResolvedValue(null),
        check: vi.fn(),
        install: vi.fn()
      },
      notification: { onPush: vi.fn(() => () => {}) },
      settings: { set: settingsSet, get: vi.fn().mockResolvedValue({}) }
    } as unknown as typeof window.api

    useAuthStore.setState({
      loggedIn: true,
      user: { id: 'user-1', name: 'TestUser', email: 'test@example.com', avatarUrl: '' },
      isLocalMode: false
    } as Partial<ReturnType<typeof useAuthStore.getState>>)
    useSettingsStore.setState({ appMode: 'general', theme: 'dark', language: 'zh-CN', fontSize: 'standard' })
    useUpdaterStore.setState({ status: 'idle', version: null } as Partial<ReturnType<typeof useUpdaterStore.getState>>)
  })

  it('places the mode capsule in the right controls, left of the avatar', async () => {
    const { container } = await renderTopBar()
    const [left, right] = Array.from(container.querySelectorAll('.cb-topbar-nodrag'))
    expect(left).toBeTruthy()
    expect(right).toBeTruthy()

    const leftTexts = buttonsIn(left).map((b) => b.textContent?.trim())
    expect(leftTexts).not.toContain('通用')
    expect(leftTexts).not.toContain('研发')

    const general = byText(buttonsIn(right), '通用')
    const avatar = right.querySelector('.ant-dropdown-trigger')
    expect(general).toBeTruthy()
    expect(byText(buttonsIn(right), '研发')).toBeTruthy()
    expect(avatar).toBeTruthy()
    expect(right.textContent).toContain('TestUser')
    expect(precedes(general!, avatar!)).toBe(true)
  })

  it('renders the downloaded-update CTA before the mode capsule', async () => {
    useUpdaterStore.setState({ status: 'downloaded', version: '1.2.0' } as Partial<
      ReturnType<typeof useUpdaterStore.getState>
    >)
    const { container } = await renderTopBar()
    const right = container.querySelectorAll('.cb-topbar-nodrag')[1]
    const update = buttonsIn(right).find((b) => b.textContent?.includes('更新客户端'))
    const general = byText(buttonsIn(right), '通用')
    const avatar = right.querySelector('.ant-dropdown-trigger')
    expect(update).toBeTruthy()
    expect(precedes(update!, general!)).toBe(true)
    expect(precedes(general!, avatar!)).toBe(true)
  })

  it('switches appMode from the capsule', async () => {
    const { container } = await renderTopBar()
    const right = container.querySelectorAll('.cb-topbar-nodrag')[1]
    await act(async () => {
      byText(buttonsIn(right), '研发')!.click()
    })
    expect(useSettingsStore.getState().appMode).toBe('pro')
  })

  it('hides the project switcher in local mode', async () => {
    useAuthStore.setState({ isLocalMode: true } as Partial<ReturnType<typeof useAuthStore.getState>>)
    const { container } = await renderTopBar()
    expect(container.querySelector('[data-testid="project-switcher"]')).toBeNull()
  })

  it('toggles font size between standard and large (+20%) in the avatar menu', async () => {
    const { container } = await renderTopBar()
    const right = container.querySelectorAll('.cb-topbar-nodrag')[1]
    await act(async () => {
      ;(right.querySelector('.ant-dropdown-trigger') as HTMLElement).click()
    })

    const large = byText(Array.from(document.querySelectorAll('button')), '放大')
    expect(large).toBeTruthy()
    await act(async () => {
      large!.click()
    })
    expect(useSettingsStore.getState().fontSize).toBe('large')
    expect(document.documentElement.getAttribute('data-font-size')).toBe('large')
    expect(settingsSet).toHaveBeenCalledWith('fontSize', 'large')

    await act(async () => {
      byText(Array.from(document.querySelectorAll('button')), '标准')!.click()
    })
    expect(useSettingsStore.getState().fontSize).toBe('standard')
    expect(document.documentElement.getAttribute('data-font-size')).toBe('standard')
  })
})

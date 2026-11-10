import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import Sidebar from '../Sidebar'
import { useSettingsStore } from '../../../stores/useSettingsStore'
import { useAttentionStore } from '../../../stores/useAttentionStore'
import { DEFAULT_MODULE_VISIBILITY } from '../../../constants/module-visibility'
import { setMotionMode } from '../../../motion'

let root: Root
let container: HTMLDivElement

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
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

async function renderSidebar(path = '/workbench/installed'): Promise<void> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <Sidebar collapsed={false} />
      </MemoryRouter>
    )
  })
}

const menuKeys = (): (string | null)[] =>
  Array.from(container.querySelectorAll('.ant-menu-item')).map((el) => el.getAttribute('data-menu-id'))

describe('Sidebar', () => {
  beforeEach(() => {
    localStorage.clear()
    window.api = {
      ...(window.api || {}),
      attention: { setTrayState: vi.fn(), onNavigateTo: vi.fn(() => () => {}) }
    } as unknown as typeof window.api
    useSettingsStore.setState({
      appMode: 'pro',
      moduleVisibility: {
        ...DEFAULT_MODULE_VISIBILITY,
        aiChat: true,
        aiCoding: true,
        aiTerminal: true,
        aiAgents: true,
        localEnv: true,
        copiper: true
      }
    })
    useAttentionStore.setState({ items: [] })
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('keeps every OSS module entry in menu order', async () => {
    await renderSidebar()
    expect(menuKeys()).toEqual([
      expect.stringContaining('/workbench'),
      expect.stringContaining('/ai-chat'),
      expect.stringContaining('/ai-coding'),
      expect.stringContaining('/ai-terminal'),
      expect.stringContaining('/ai-agents'),
      expect.stringContaining('/local-env'),
      expect.stringContaining('/copiper')
    ])
  })

  it('hides disabled modules without reordering the rest', async () => {
    useSettingsStore.setState({
      moduleVisibility: {
        ...useSettingsStore.getState().moduleVisibility,
        aiChat: false,
        copiper: false
      }
    })
    await renderSidebar()
    expect(menuKeys()).toEqual([
      expect.stringContaining('/workbench'),
      expect.stringContaining('/ai-coding'),
      expect.stringContaining('/ai-terminal'),
      expect.stringContaining('/ai-agents'),
      expect.stringContaining('/local-env')
    ])
  })

  it('menu icons get the spring hover micro-interaction', async () => {
    setMotionMode('elegant')
    await renderSidebar()
    const item = container.querySelector('.ant-menu-item') as HTMLElement
    const icon = item.querySelector('.cb-morph-icon') as HTMLElement
    expect(icon).toBeTruthy()
    await act(async () => {
      item.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
    })
    expect(icon.style.transform).toBe('scale(1.12)')
  })

  it('clicking Workbench acknowledges workbench attention items', async () => {
    useAttentionStore.setState({
      items: [
        { id: 'a', source: 'workbench', title: 'done', createdAt: 1 },
        { id: 'b', source: 'ai-coding', targetId: 's1', title: 'wait', createdAt: 2 }
      ] as unknown as ReturnType<typeof useAttentionStore.getState>['items']
    })
    await renderSidebar('/ai-coding')
    const workbench = Array.from(container.querySelectorAll('.ant-menu-item')).find((el) =>
      el.getAttribute('data-menu-id')?.includes('/workbench')
    ) as HTMLElement
    await act(async () => {
      workbench.click()
    })
    const sources = useAttentionStore.getState().items.map((i) => i.source)
    expect(sources).toEqual(['ai-coding'])
  })
})

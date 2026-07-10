import React, { act } from 'react'
import { App as AntdApp } from 'antd'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SubAppManifest } from '../../types/subapp'
import { clearDynamicOptionsCache } from '../../utils/subapp-dynamic-options'
import ParamDrawer from '../ParamDrawer'

const manifest: SubAppManifest = {
  id: 'app.id',
  name: 'Dynamic App',
  version: '1.0.0',
  description: 'test',
  author: 'Tester',
  entry: 'main.py',
  params: [
    {
      name: 'proxy_url',
      type: 'string',
      label: 'Proxy URL',
      default: 'http://proxy'
    },
    {
      name: 'model',
      type: 'enum',
      label: 'Model',
      default: 'old',
      options: ['old'],
      options_slot: 'models'
    }
  ]
}

interface RenderedDrawer {
  root: Root
  container: HTMLDivElement
}

const mounted: RenderedDrawer[] = []

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

beforeEach(() => {
  clearDynamicOptionsCache()
})

afterEach(async () => {
  for (const item of mounted.splice(0)) {
    await act(async () => item.root.unmount())
    item.container.remove()
  }
  document.body.innerHTML = ''
})

async function renderDrawer(
  resolveSlot: (
    appId: string,
    slot: string,
    params?: Record<string, unknown>
  ) => Promise<unknown>,
  initialValues: Record<string, unknown> = {
    proxy_url: 'http://proxy',
    model: 'old'
  }
): Promise<RenderedDrawer> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const rendered = { root, container }
  mounted.push(rendered)

  await act(async () => {
    root.render(
      <AntdApp>
        <ParamDrawer
          open
          onClose={vi.fn()}
          manifest={manifest}
          initialValues={initialValues}
          resolveSlot={resolveSlot}
          onSubmit={vi.fn()}
        />
      </AntdApp>
    )
    await Promise.resolve()
  })

  return rendered
}

function findButton(text: string): HTMLButtonElement {
  const normalizedText = text.replace(/\s/g, '')
  const button = Array.from(document.querySelectorAll('button')).find(
    (candidate) => candidate.textContent?.replace(/\s/g, '') === normalizedText
  )
  if (!button) {
    const labels = Array.from(document.querySelectorAll('button')).map(
      (candidate) => `${candidate.textContent?.trim() || '<empty>'}:${candidate.disabled}`
    )
    throw new Error(`Button not found: ${text}; rendered buttons: ${labels.join(', ')}`)
  }
  return button
}

function refreshButton(): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>(
    'button[aria-label="刷新选项"]'
  )
  if (!button) throw new Error('Refresh button not found')
  return button
}

function selectedModel(): string | null | undefined {
  return document.querySelector('.ant-select-selection-item')?.textContent
}

describe('ParamDrawer dynamic options', () => {
  it('keeps the drawer open, passes current values, and applies refreshed options', async () => {
    let finish: ((data: unknown) => void) | undefined
    const resolveSlot = vi.fn(
      () => new Promise<unknown>((resolve) => { finish = resolve })
    )
    await renderDrawer(resolveSlot)

    await act(async () => {
      refreshButton().dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(resolveSlot).toHaveBeenCalledWith('app.id', 'models', {
      proxy_url: 'http://proxy',
      model: 'old'
    })
    expect(document.querySelector('.ant-drawer')).not.toBeNull()
    expect(findButton('执行').disabled).toBe(true)
    expect(findButton('取消').disabled).toBe(false)

    await act(async () => {
      finish?.({ options: ['new-a', 'new-b'], default: 'new-b' })
      await Promise.resolve()
    })

    expect(document.querySelector('.ant-drawer')).not.toBeNull()
    expect(selectedModel()).toBe('new-b')
    expect(findButton('执行').disabled).toBe(false)
    expect(document.body.textContent).toContain('已刷新 2 个选项')
  })

  it('reuses cached options after the drawer is remounted', async () => {
    const resolveSlot = vi.fn().mockResolvedValue({
      options: ['cached-a', 'cached-b'],
      default: 'cached-b'
    })
    const first = await renderDrawer(resolveSlot)

    await act(async () => {
      refreshButton().dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })
    expect(selectedModel()).toBe('cached-b')

    await act(async () => first.root.unmount())
    first.container.remove()
    mounted.splice(mounted.indexOf(first), 1)

    const secondResolver = vi.fn().mockRejectedValue(new Error('must not run'))
    await renderDrawer(secondResolver, { proxy_url: 'http://proxy', model: 'gone' })

    expect(selectedModel()).toBe('cached-b')
    expect(secondResolver).not.toHaveBeenCalled()
  })

  it('keeps the existing options and selection when refresh fails', async () => {
    const resolveSlot = vi.fn().mockRejectedValue(new Error('proxy unavailable'))
    await renderDrawer(resolveSlot)

    await act(async () => {
      refreshButton().dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(document.querySelector('.ant-drawer')).not.toBeNull()
    expect(selectedModel()).toBe('old')
    expect(document.body.textContent).toContain('proxy unavailable')
  })

  it('does not apply a stale result after another App replaces the drawer', async () => {
    let finish: ((data: unknown) => void) | undefined
    const resolveSlot = vi.fn(
      () => new Promise<unknown>((resolve) => { finish = resolve })
    )
    const rendered = await renderDrawer(resolveSlot)

    await act(async () => {
      refreshButton().dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    const otherManifest: SubAppManifest = {
      ...manifest,
      id: 'other.app',
      name: 'Other App',
      params: [
        {
          name: 'model',
          type: 'enum',
          label: 'Model',
          default: 'other-old',
          options: ['other-old']
        }
      ]
    }
    await act(async () => {
      rendered.root.render(
        <AntdApp>
          <ParamDrawer
            open
            onClose={vi.fn()}
            manifest={otherManifest}
            initialValues={{ model: 'other-old' }}
            resolveSlot={vi.fn()}
            onSubmit={vi.fn()}
          />
        </AntdApp>
      )
      await Promise.resolve()
    })

    await act(async () => {
      finish?.({ options: ['stale-new'], default: 'stale-new' })
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain('Other App')
    expect(selectedModel()).toBe('other-old')
  })
})

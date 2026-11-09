import React, { act } from 'react'
import { App as AntdApp } from 'antd'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import SubAppDialog from '../SubAppDialog'

interface RenderedDialog {
  root: Root
  container: HTMLDivElement
}

type UiListener = (event: unknown) => void

const mounted: RenderedDialog[] = []
let uiListener: UiListener | null = null
const mockSendUiEvent = vi.fn()

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

  // Mock window.api.subapp
  const mockWindow = window as unknown as {
    api: {
      subapp: {
        onUi: (listener: UiListener) => () => void
        sendUiEvent: (event: unknown) => void
      }
    }
  }
  mockWindow.api = {
    subapp: {
      onUi: vi.fn((listener: UiListener) => {
        uiListener = listener
        return () => {
          uiListener = null
        }
      }),
      sendUiEvent: mockSendUiEvent
    }
  }
})

afterEach(async () => {
  for (const item of mounted.splice(0)) {
    await act(async () => item.root.unmount())
    item.container.remove()
  }
  document.body.innerHTML = ''
  mockSendUiEvent.mockClear()
})

describe('SubAppDialog', () => {
  it('defaults to not closing on background mask click, only closing on explicit close button', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    mounted.push({ root, container })

    await act(async () => {
      root.render(
        <AntdApp>
          <SubAppDialog />
        </AntdApp>
      )
      await Promise.resolve()
    })

    // Trigger ui_show event
    await act(async () => {
      uiListener?.({
        taskId: 'task-1',
        type: 'ui_show',
        dialog: {
          id: 'dlg-1',
          title: 'Execution Dialog',
          components: [],
          footer_buttons: [],
          closable: true
        }
      })
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain('Execution Dialog')

    // Find wrap (modal backdrop container) and click it
    const wrap = document.querySelector<HTMLElement>('.ant-modal-wrap')
    expect(wrap).toBeTruthy()
    await act(async () => {
      wrap?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    // Dialog should still be open
    expect(document.body.textContent).toContain('Execution Dialog')
    expect(mockSendUiEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'dialog_close' })
    )

    // Click close button
    const closeBtn = document.querySelector<HTMLButtonElement>('.ant-modal-close')
    expect(closeBtn).toBeTruthy()
    await act(async () => {
      closeBtn?.click()
      await Promise.resolve()
    })

    expect(mockSendUiEvent).toHaveBeenCalledWith(
      'task-1',
      expect.objectContaining({ type: 'dialog_close', dialog_id: 'dlg-1' })
    )
  })

  it('allows closing on background mask click when mask_closable is explicitly true', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    mounted.push({ root, container })

    await act(async () => {
      root.render(
        <AntdApp>
          <SubAppDialog />
        </AntdApp>
      )
      await Promise.resolve()
    })

    // Trigger ui_show event with mask_closable: true
    await act(async () => {
      uiListener?.({
        taskId: 'task-2',
        type: 'ui_show',
        dialog: {
          id: 'dlg-2',
          title: 'Closable Dialog',
          components: [],
          footer_buttons: [],
          closable: true,
          mask_closable: true
        }
      })
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain('Closable Dialog')

    // Click wrap (modal backdrop container)
    const wrap = document.querySelector<HTMLElement>('.ant-modal-wrap')
    expect(wrap).toBeTruthy()
    await act(async () => {
      wrap?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(mockSendUiEvent).toHaveBeenCalledWith(
      'task-2',
      expect.objectContaining({ type: 'dialog_close', dialog_id: 'dlg-2' })
    )
  })
})

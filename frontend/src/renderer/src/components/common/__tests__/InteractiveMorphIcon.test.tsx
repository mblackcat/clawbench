import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PlusOutlined, StarOutlined, CopyOutlined, CheckOutlined } from '@ant-design/icons'
import { InteractiveMorphIcon } from '../InteractiveMorphIcon'
import { isMotionEnabled, setMotionMode } from '../../../motion'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('InteractiveMorphIcon & motion switch', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    localStorage.clear()
    document.documentElement.removeAttribute('data-motion')
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    document.documentElement.removeAttribute('data-motion')
    localStorage.clear()
  })

  const iconSpan = (): HTMLElement => container.querySelector('.cb-morph-icon') as HTMLElement
  const hover = async (el: Element, enter: boolean): Promise<void> => {
    await act(async () => {
      el.dispatchEvent(new MouseEvent(enter ? 'mouseenter' : 'mouseleave', { bubbles: true }))
    })
  }

  it('animates (spring scale) in elegant mode', async () => {
    setMotionMode('elegant')
    expect(isMotionEnabled()).toBe(true)

    await act(async () => {
      root.render(
        <button>
          <InteractiveMorphIcon icon={<PlusOutlined />} hoverIcon={<StarOutlined />} size={16} />
        </button>
      )
    })

    expect(iconSpan()).toBeTruthy()
    expect(iconSpan().style.transform).toBe('scale(1)')
    expect(iconSpan().style.fontSize).toBe('16px')
  })

  it('is static (no transform / transition) in agile mode', async () => {
    setMotionMode('agile')
    expect(isMotionEnabled()).toBe(false)

    await act(async () => {
      root.render(
        <button>
          <InteractiveMorphIcon icon={<PlusOutlined />} hoverIcon={<StarOutlined />} size={16} />
        </button>
      )
    })

    expect(iconSpan().style.transform).toBe('none')
    expect(iconSpan().style.transition).toBe('none')
  })

  it('follows the motion switch at runtime', async () => {
    setMotionMode('elegant')
    await act(async () => {
      root.render(
        <button>
          <InteractiveMorphIcon icon={<PlusOutlined />} />
        </button>
      )
    })
    expect(iconSpan().style.transform).toBe('scale(1)')

    await act(async () => setMotionMode('agile'))
    expect(iconSpan().style.transform).toBe('none')

    await act(async () => setMotionMode('elegant'))
    expect(iconSpan().style.transform).toBe('scale(1)')
  })

  it('hovering the parent control grows the icon and swaps to hoverIcon', async () => {
    setMotionMode('elegant')
    await act(async () => {
      root.render(
        <div className="ant-segmented-item" id="seg">
          <InteractiveMorphIcon icon={<PlusOutlined />} hoverIcon={<StarOutlined />} size={14} />
        </div>
      )
    })
    const parent = container.querySelector('#seg') as HTMLElement
    expect(container.querySelector('.anticon-plus')).toBeTruthy()

    await hover(parent, true)
    expect(iconSpan().style.transform).toBe('scale(1.12)')
    expect(container.querySelector('.anticon-star')).toBeTruthy()
    expect(container.querySelector('.anticon-plus')).toBeNull()

    await hover(parent, false)
    expect(iconSpan().style.transform).toBe('scale(1)')
    expect(container.querySelector('.anticon-plus')).toBeTruthy()
  })

  it('shrinks while pressed', async () => {
    setMotionMode('elegant')
    await act(async () => {
      root.render(
        <button id="btn">
          <InteractiveMorphIcon icon={<PlusOutlined />} />
        </button>
      )
    })
    const btn = container.querySelector('#btn') as HTMLElement
    await act(async () => {
      btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    expect(iconSpan().style.transform).toBe('scale(0.88)')
    await act(async () => {
      btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    })
    expect(iconSpan().style.transform).not.toBe('scale(0.88)')
  })

  it('never swaps on hover in agile mode, but keeps the semantic active icon', async () => {
    setMotionMode('agile')
    await act(async () => {
      root.render(
        <button id="btn">
          <InteractiveMorphIcon icon={<PlusOutlined />} hoverIcon={<StarOutlined />} />
        </button>
      )
    })
    await hover(container.querySelector('#btn')!, true)
    expect(container.querySelector('.anticon-plus')).toBeTruthy()
    expect(container.querySelector('.anticon-star')).toBeNull()

    await act(async () => {
      root.render(
        <button id="btn">
          <InteractiveMorphIcon icon={<PlusOutlined />} activeIcon={<CheckOutlined />} active />
        </button>
      )
    })
    expect(container.querySelector('.anticon-check')).toBeTruthy()
  })

  it('accepts icon components as well as elements', async () => {
    await act(async () => {
      root.render(<InteractiveMorphIcon icon={CopyOutlined} />)
    })
    expect(container.querySelector('.anticon-copy')).toBeTruthy()
  })

  it('cross-fades only after a swap (swapKey change), not on mount', async () => {
    setMotionMode('elegant')
    await act(async () => {
      root.render(<InteractiveMorphIcon icon={<CopyOutlined />} swapKey={false} />)
    })
    expect(container.querySelector('.cb-morph-layer-in')).toBeNull()

    await act(async () => {
      root.render(<InteractiveMorphIcon icon={<CheckOutlined />} swapKey={true} />)
    })
    expect(container.querySelector('.anticon-check')).toBeTruthy()
    expect(container.querySelector('.cb-morph-layer-in')).toBeTruthy()
  })
})

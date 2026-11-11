import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PanelLeftClose, Sparkles, Plus, Check } from 'lucide'
import { InteractiveMorphIcon } from '../InteractiveMorphIcon'
import { AntdMorphIcon } from '../AntdMorphIcon'
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

  const iconSpan = (): HTMLElement => container.querySelector('.interactive-morph-icon') as HTMLElement
  const svgMarkup = (): string => iconSpan().querySelector('svg')?.innerHTML ?? ''
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
          <InteractiveMorphIcon icon={Plus} hoverIcon={Sparkles} size={16} />
        </button>
      )
    })

    expect(iconSpan()).toBeTruthy()
    expect(iconSpan().classList.contains('anticon')).toBe(true)
    expect(iconSpan().classList.contains('cb-morph-icon')).toBe(true)
    expect(iconSpan().style.transform).toBe('scale(1)')
    const svg = iconSpan().querySelector('svg') as SVGElement
    expect(svg).toBeTruthy()
    expect(svg.getAttribute('width')).toBe('16')
  })

  it('defaults to 1em so it inherits the antd font-size', async () => {
    await act(async () => {
      root.render(<InteractiveMorphIcon icon={Plus} />)
    })
    expect(iconSpan().querySelector('svg')?.getAttribute('width')).toBe('1em')
  })

  it('paints with currentColor (theme tokens), never a hardcoded color', async () => {
    await act(async () => {
      root.render(<InteractiveMorphIcon icon={Plus} />)
    })
    const svg = iconSpan().querySelector('svg') as SVGElement
    expect(svg.outerHTML).toContain('currentColor')
    expect(svg.outerHTML).not.toMatch(/#[0-9a-f]{3,6}\b/i)
  })

  it('is static (no transform / transition) in agile mode', async () => {
    setMotionMode('agile')
    expect(isMotionEnabled()).toBe(false)

    await act(async () => {
      root.render(
        <button>
          <InteractiveMorphIcon icon={Plus} hoverIcon={Sparkles} size={16} />
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
          <InteractiveMorphIcon icon={Plus} hoverIcon={Sparkles} size={16} />
        </button>
      )
    })
    expect(iconSpan().style.transform).toBe('scale(1)')

    await act(async () => setMotionMode('agile'))
    expect(iconSpan().style.transform).toBe('none')

    await act(async () => setMotionMode('elegant'))
    expect(iconSpan().style.transform).toBe('scale(1)')
  })

  it('AntdMorphIcon respects motion mode seamlessly', async () => {
    setMotionMode('agile')
    await act(async () => {
      root.render(<AntdMorphIcon icon={PanelLeftClose} size={16} />)
    })
    const span = container.querySelector('.anticon')
    expect(span).toBeTruthy()
    expect(span?.querySelector('svg')).toBeTruthy()
  })

  it('hovering the parent .ant-segmented-item grows the icon', async () => {
    setMotionMode('elegant')
    await act(async () => {
      root.render(
        <div className="ant-segmented-item" id="seg">
          <InteractiveMorphIcon icon={Plus} hoverIcon={Sparkles} size={14} triggerScope="parent" />
        </div>
      )
    })
    const parent = container.querySelector('#seg') as HTMLElement
    expect(iconSpan().style.transform).toBe('scale(1)')

    await hover(parent, true)
    expect(iconSpan().style.transform).toBe('scale(1.12)')

    await hover(parent, false)
    expect(iconSpan().style.transform).toBe('scale(1)')
  })

  it('shrinks while pressed', async () => {
    setMotionMode('elegant')
    await act(async () => {
      root.render(
        <button id="btn">
          <InteractiveMorphIcon icon={Plus} />
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

  it('never morphs on hover in agile mode, but keeps the semantic active icon', async () => {
    setMotionMode('agile')
    await act(async () => {
      root.render(
        <button id="btn">
          <InteractiveMorphIcon icon={Plus} hoverIcon={Sparkles} />
        </button>
      )
    })
    const idle = svgMarkup()
    await hover(container.querySelector('#btn')!, true)
    expect(svgMarkup()).toBe(idle)

    await act(async () => {
      root.render(
        <button id="btn">
          <InteractiveMorphIcon icon={Plus} activeIcon={Check} active />
        </button>
      )
    })
    expect(svgMarkup()).not.toBe(idle)
  })
})

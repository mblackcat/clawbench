import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { AntdMorphIcon } from '../AntdMorphIcon'
import { PanelLeftClose, PanelLeftOpen } from 'lucide'

describe('AntdMorphIcon', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
  })

  it('renders morphicon inside anticon span', () => {
    act(() => {
      root.render(<AntdMorphIcon icon={PanelLeftClose} size={16} />)
    })
    const span = container.querySelector('.anticon')
    expect(span).toBeTruthy()
    const svg = span?.querySelector('svg')
    expect(svg).toBeTruthy()
  })

  it('updates when icon prop changes', () => {
    act(() => {
      root.render(<AntdMorphIcon icon={PanelLeftClose} size={16} />)
    })
    act(() => {
      root.render(<AntdMorphIcon icon={PanelLeftOpen} size={16} />)
    })
    const span = container.querySelector('.anticon')
    expect(span).toBeTruthy()
  })
})

import React from 'react'
import { act } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import AgentConfigCard from '../AgentConfigCard'

describe('AgentConfigCard', () => {
  it('renders title and summary in a stacked metadata column and prevents badge wrapping', () => {
    const html = renderToStaticMarkup(
      <AgentConfigCard
        icon={<span>H</span>}
        title="Anthropic"
        summary="Claude Sonnet / Opus / Haiku"
        badge="API Key"
        enabled={true}
      />
    )

    expect(html).toContain('flex-direction:column')
    expect(html).toContain('API Key')
    expect(html).toContain('white-space:nowrap')
  })

  it('notifies callers when the expand button is clicked', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const onExpandChange = vi.fn()

    act(() => {
      root.render(
        <AgentConfigCard
          {...({ onExpandChange } as any)}
          icon={<span>H</span>}
          title="OpenAI"
          description="Provider config"
        />
      )
    })

    const expandButton = container.querySelector('button')
    expect(expandButton).not.toBeNull()

    act(() => {
      expandButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(onExpandChange).toHaveBeenCalledWith(true)

    act(() => {
      root.unmount()
    })
    container.remove()
  })
})

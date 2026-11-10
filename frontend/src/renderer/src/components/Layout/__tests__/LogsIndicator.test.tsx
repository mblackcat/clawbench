import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it } from 'vitest'
import { useLogsIndicator, type LogsIndicatorState } from '../LogsIndicator'
import { useAttentionStore } from '../../../stores/useAttentionStore'
import { useNotificationStore } from '../../../stores/useNotificationStore'
import { useTaskStore } from '../../../stores/useTaskStore'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function readState(): LogsIndicatorState {
  let state: LogsIndicatorState | null = null
  const Probe: React.FC = () => {
    state = useLogsIndicator()
    return null
  }
  const container = document.createElement('div')
  const root = createRoot(container)
  act(() => root.render(<Probe />))
  act(() => root.unmount())
  return state!
}

describe('useLogsIndicator', () => {
  beforeEach(() => {
    useAttentionStore.setState({ items: [] })
    useNotificationStore.setState({ unreadCount: 0 } as Partial<ReturnType<typeof useNotificationStore.getState>>)
    useTaskStore.setState({ hasUnseenErrors: false, hasErrorAlert: false, hasUnreadLogs: false })
  })

  it('does not badge attention items (the logs drawer cannot clear them)', () => {
    useAttentionStore.setState({
      items: [{ id: 'a', source: 'ai-coding', targetId: 's1', title: 'waiting', createdAt: 1 }] as unknown as ReturnType<
        typeof useAttentionStore.getState
      >['items']
    })
    const s = readState()
    expect(s.badgeCount).toBe(0)
    expect(s.hasAlert).toBe(false)
    expect(s.showDot).toBe(false)
  })

  it('still badges notifications, errors and unread logs', () => {
    useNotificationStore.setState({ unreadCount: 3 } as Partial<ReturnType<typeof useNotificationStore.getState>>)
    expect(readState()).toMatchObject({ badgeCount: 3, hasAlert: true, showDot: false })

    useNotificationStore.setState({ unreadCount: 0 } as Partial<ReturnType<typeof useNotificationStore.getState>>)
    useTaskStore.setState({ hasUnseenErrors: true })
    expect(readState()).toMatchObject({ badgeCount: 0, hasAlert: true, hasErrors: true, showDot: true })

    useTaskStore.setState({ hasUnseenErrors: false, hasUnreadLogs: true })
    expect(readState()).toMatchObject({ hasAlert: false, showDot: true })
  })
})

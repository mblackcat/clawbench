import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../i18n', () => ({ getT: () => (k: string) => k }))

import {
  useAttentionStore,
  isViewingTarget,
  raiseCodingCompletion,
  raiseCodingAction,
  raiseWorkbenchCompletion,
  dismissCodingTarget
} from '../useAttentionStore'

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

describe('attention: AI Coding landing panel + window focus', () => {
  beforeEach(() => {
    useAttentionStore.setState({
      items: [],
      context: { pathname: '/ai-coding', activeChatId: null, activeCodingId: 's1', codingLandingVisible: false }
    })
  })

  it('landing panel counts as not viewing the active session', () => {
    const ctx = { pathname: '/ai-coding', activeChatId: null, activeCodingId: 's1' }
    expect(isViewingTarget(ctx, 'ai-coding', 's1')).toBe(true)
    expect(isViewingTarget({ ...ctx, codingLandingVisible: true }, 'ai-coding', 's1')).toBe(false)
  })

  it('keeps a completion raised while the landing panel covers the session', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    useAttentionStore.getState().setContext({ codingLandingVisible: true })
    await flush()
    raiseCodingCompletion('s1', 'done')
    await flush()
    expect(useAttentionStore.getState().hasSessionAttention('s1')).toBe(true)
    // leaving the landing view (session visible again) clears it
    useAttentionStore.getState().setContext({ codingLandingVisible: false })
    await flush()
    expect(useAttentionStore.getState().hasSessionAttention('s1')).toBe(false)
  })

  it('a completion raised while unfocused is cleared by clearViewed on refocus', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    raiseCodingCompletion('s1', 'done')
    await flush()
    expect(useAttentionStore.getState().hasSessionAttention('s1')).toBe(true)
    useAttentionStore.getState().clearViewed()
    expect(useAttentionStore.getState().hasSessionAttention('s1')).toBe(false)
  })
})

describe('attention: dismiss is a no-op when nothing matches', () => {
  beforeEach(() => {
    useAttentionStore.setState({
      items: [],
      context: { pathname: '/ai-coding', activeChatId: null, activeCodingId: null }
    })
  })

  it('keeps the items reference (no re-render) when the target has no attention', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    raiseCodingCompletion('s1', 'done')
    await flush()
    const before = useAttentionStore.getState().items
    const listener = vi.fn()
    const unsub = useAttentionStore.subscribe(listener)
    useAttentionStore.getState().dismissByTarget('ai-coding', 'other')
    useAttentionStore.getState().dismissBySource('ai-chat')
    unsub()
    expect(listener).not.toHaveBeenCalled()
    expect(useAttentionStore.getState().items).toBe(before)
  })

  it('still removes a matching item', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    raiseCodingCompletion('s1', 'done')
    await flush()
    useAttentionStore.getState().dismissByTarget('ai-coding', 's1')
    expect(useAttentionStore.getState().hasSessionAttention('s1')).toBe(false)
  })
})

describe('attention: red dots that must clear', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    useAttentionStore.setState({
      items: [],
      context: { pathname: '/settings', activeChatId: null, activeCodingId: null }
    })
  })

  it('clearViewed clears workbench completions only when on a workbench route', () => {
    raiseWorkbenchCompletion('task-1', 'Test App')
    expect(useAttentionStore.getState().items.length).toBe(1)
    expect(useAttentionStore.getState().items[0].source).toBe('workbench')

    useAttentionStore.getState().clearViewed()
    expect(useAttentionStore.getState().items.length).toBe(1)

    useAttentionStore.setState({
      context: { pathname: '/workbench/installed', activeChatId: null, activeCodingId: null }
    })
    useAttentionStore.getState().clearViewed()
    expect(useAttentionStore.getState().items.length).toBe(0)
  })

  it('dismissBySource clears all workbench items', () => {
    raiseWorkbenchCompletion('task-1', 'App 1')
    raiseWorkbenchCompletion('task-2', 'App 2')
    expect(useAttentionStore.getState().items.length).toBe(2)

    useAttentionStore.getState().dismissBySource('workbench')
    expect(useAttentionStore.getState().items.length).toBe(0)
  })

  it('clearViewed clears a coding completion only when viewing that session', () => {
    raiseCodingCompletion('session-1', 'Session Title')
    expect(useAttentionStore.getState().items.length).toBe(1)

    useAttentionStore.setState({
      context: { pathname: '/ai-coding', activeChatId: null, activeCodingId: 'session-2' }
    })
    useAttentionStore.getState().clearViewed()
    expect(useAttentionStore.getState().items.length).toBe(1)

    useAttentionStore.setState({
      context: { pathname: '/ai-coding', activeChatId: null, activeCodingId: 'session-1' }
    })
    useAttentionStore.getState().clearViewed()
    expect(useAttentionStore.getState().items.length).toBe(0)
  })

  it('dismissCodingTarget clears the target regardless of kind', () => {
    raiseCodingAction('session-3', 'Action needed')
    expect(useAttentionStore.getState().items.length).toBe(1)

    dismissCodingTarget('session-3')
    expect(useAttentionStore.getState().items.length).toBe(0)
  })
})

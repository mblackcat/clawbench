import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../i18n', () => ({ getT: () => (k: string) => k }))

import { useAttentionStore, isViewingTarget, raiseCodingCompletion } from '../useAttentionStore'

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

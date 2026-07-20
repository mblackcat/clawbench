import { create } from 'zustand'
import { getT } from '../i18n'

/** completion = 红点提醒；action = 需要用户确认（闪烁，优先） */
export type AttentionKind = 'completion' | 'action'
export type AttentionSource = 'workbench' | 'ai-chat' | 'ai-coding'

export interface AttentionItem {
  id: string
  kind: AttentionKind
  source: AttentionSource
  /** conversationId / coding sessionId / workbench taskId */
  targetId?: string
  title: string
  body?: string
  createdAt: number
}

export interface AttentionContext {
  pathname: string
  activeChatId: string | null
  activeCodingId: string | null
}

interface AttentionState {
  items: AttentionItem[]
  context: AttentionContext
  /** Registered by AttentionManager for in-app navigation */
  navigateHandler: ((item: AttentionItem) => void) | null

  setContext: (partial: Partial<AttentionContext>) => void
  setNavigateHandler: (handler: ((item: AttentionItem) => void) | null) => void

  /** Raise an attention (deduped by source+kind+targetId) */
  raise: (input: {
    kind: AttentionKind
    source: AttentionSource
    targetId?: string
    title: string
    body?: string
  }) => void

  dismiss: (id: string) => void
  dismissByTarget: (source: AttentionSource, targetId: string) => void
  dismissBySource: (source: AttentionSource) => void
  /** Clear attentions the user is currently viewing */
  clearViewed: () => void

  getFirst: () => AttentionItem | null
  openFirst: () => AttentionItem | null

  hasSource: (source: AttentionSource) => boolean
  hasTarget: (source: AttentionSource, targetId: string) => boolean
  hasAction: () => boolean
  hasAny: () => boolean
}

function makeId(): string {
  return `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function isOnSourcePage(pathname: string, source: AttentionSource): boolean {
  if (source === 'workbench') return pathname.startsWith('/workbench')
  if (source === 'ai-chat') return pathname.startsWith('/ai-chat')
  if (source === 'ai-coding') return pathname.startsWith('/ai-coding')
  return false
}

/**
 * Whether the user is actively viewing the target that produced this event.
 * - workbench: on any workbench route
 * - chat/coding: on the module page AND viewing that session
 */
export function isViewingTarget(
  ctx: AttentionContext,
  source: AttentionSource,
  targetId?: string
): boolean {
  if (!isOnSourcePage(ctx.pathname, source)) return false
  if (source === 'workbench') return true
  if (!targetId) return true
  if (source === 'ai-chat') return ctx.activeChatId === targetId
  if (source === 'ai-coding') return ctx.activeCodingId === targetId
  return false
}

/** Action (flash) only when the user is not on the module page at all */
export function shouldFlashForSource(ctx: AttentionContext, source: AttentionSource): boolean {
  return !isOnSourcePage(ctx.pathname, source)
}

function pickFirst(items: AttentionItem[]): AttentionItem | null {
  if (items.length === 0) return null
  const actions = items
    .filter((i) => i.kind === 'action')
    .sort((a, b) => a.createdAt - b.createdAt)
  if (actions.length > 0) return actions[0]
  return [...items].sort((a, b) => a.createdAt - b.createdAt)[0]
}

function syncTray(items: AttentionItem[], ctx: AttentionContext): void {
  try {
    const hasAction = items.some(
      (i) => i.kind === 'action' && shouldFlashForSource(ctx, i.source)
    )
    const hasDot = items.length > 0
    window.api.attention?.setTrayState?.({ flash: hasAction, hasDot })
  } catch {
    // Preload may not expose attention API in tests
  }
}

export const useAttentionStore = create<AttentionState>((set, get) => ({
  items: [],
  context: { pathname: '', activeChatId: null, activeCodingId: null },
  navigateHandler: null,

  setContext: (partial) => {
    set((s) => {
      const context = { ...s.context, ...partial }
      // Defer tray sync + auto-clear after state settles
      queueMicrotask(() => {
        const state = get()
        state.clearViewed()
        syncTray(get().items, get().context)
      })
      return { context }
    })
  },

  setNavigateHandler: (handler) => set({ navigateHandler: handler }),

  raise: (input) => {
    const ctx = get().context
    // Never raise if user is already viewing this target
    if (isViewingTarget(ctx, input.source, input.targetId)) return

    // For action kind: only flash-relevant when off module page;
    // still raise as action so session/menu red dots work when on page but other session.
    // When already on the module page viewing another session, keep as action for session dots
    // but tray won't flash (shouldFlashForSource).

    set((s) => {
      const keyMatch = (i: AttentionItem) =>
        i.source === input.source &&
        i.kind === input.kind &&
        (i.targetId || '') === (input.targetId || '')

      const existing = s.items.find(keyMatch)
      const item: AttentionItem = existing
        ? {
            ...existing,
            title: input.title,
            body: input.body,
            // keep earliest createdAt for chronological open-first
            createdAt: existing.createdAt
          }
        : {
            id: makeId(),
            kind: input.kind,
            source: input.source,
            targetId: input.targetId,
            title: input.title,
            body: input.body,
            createdAt: Date.now()
          }

      const rest = s.items.filter((i) => !keyMatch(i))
      // Upgrade completion → action for same target (action is higher priority)
      const cleaned =
        input.kind === 'action'
          ? rest.filter(
              (i) =>
                !(
                  i.source === input.source &&
                  i.kind === 'completion' &&
                  (i.targetId || '') === (input.targetId || '')
                )
            )
          : rest

      const items = [item, ...cleaned]
      queueMicrotask(() => syncTray(get().items, get().context))
      return { items }
    })
  },

  dismiss: (id) => {
    set((s) => {
      const items = s.items.filter((i) => i.id !== id)
      queueMicrotask(() => syncTray(get().items, get().context))
      return { items }
    })
  },

  dismissByTarget: (source, targetId) => {
    set((s) => {
      const items = s.items.filter(
        (i) => !(i.source === source && (i.targetId || '') === targetId)
      )
      queueMicrotask(() => syncTray(get().items, get().context))
      return { items }
    })
  },

  dismissBySource: (source) => {
    set((s) => {
      const items = s.items.filter((i) => i.source !== source)
      queueMicrotask(() => syncTray(get().items, get().context))
      return { items }
    })
  },

  clearViewed: () => {
    const { context, items } = get()
    if (items.length === 0) return

    const next = items.filter((item) => {
      if (!isOnSourcePage(context.pathname, item.source)) return true
      if (item.source === 'workbench') return false // viewing workbench → clear all workbench
      if (!item.targetId) return false
      if (item.source === 'ai-chat') return context.activeChatId !== item.targetId
      if (item.source === 'ai-coding') return context.activeCodingId !== item.targetId
      return true
    })

    if (next.length !== items.length) {
      set({ items: next })
      queueMicrotask(() => syncTray(get().items, get().context))
    }
  },

  getFirst: () => pickFirst(get().items),

  openFirst: () => {
    const item = pickFirst(get().items)
    if (!item) return null
    const handler = get().navigateHandler
    handler?.(item)
    get().dismiss(item.id)
    return item
  },

  hasSource: (source) => get().items.some((i) => i.source === source),
  hasTarget: (source, targetId) =>
    get().items.some((i) => i.source === source && i.targetId === targetId),
  hasAction: () => {
    const { items, context } = get()
    return items.some((i) => i.kind === 'action' && shouldFlashForSource(context, i.source))
  },
  hasAny: () => get().items.length > 0
}))

// ── Convenience helpers used by other stores ──────────────────────────

export function raiseWorkbenchCompletion(taskId: string, appName: string): void {
  const t = getT()
  useAttentionStore.getState().raise({
    kind: 'completion',
    source: 'workbench',
    targetId: taskId,
    title: t('attention.workbenchDone', appName),
    body: t('attention.workbenchDoneBody')
  })
}

export function raiseChatCompletion(conversationId: string, title?: string): void {
  const t = getT()
  useAttentionStore.getState().raise({
    kind: 'completion',
    source: 'ai-chat',
    targetId: conversationId,
    title: title || t('attention.chatDone'),
    body: t('attention.chatDoneBody')
  })
}

export function raiseChatAction(conversationId: string, title?: string, body?: string): void {
  const t = getT()
  useAttentionStore.getState().raise({
    kind: 'action',
    source: 'ai-chat',
    targetId: conversationId,
    title: title || t('attention.chatAction'),
    body: body || t('attention.chatActionBody')
  })
}

export function raiseCodingCompletion(sessionId: string, title?: string): void {
  const t = getT()
  useAttentionStore.getState().raise({
    kind: 'completion',
    source: 'ai-coding',
    targetId: sessionId,
    title: title || t('attention.codingDone'),
    body: t('attention.codingDoneBody')
  })
}

export function raiseCodingAction(sessionId: string, title?: string, body?: string): void {
  const t = getT()
  useAttentionStore.getState().raise({
    kind: 'action',
    source: 'ai-coding',
    targetId: sessionId,
    title: title || t('attention.codingAction'),
    body: body || t('attention.codingActionBody')
  })
}

export function dismissChatTarget(conversationId: string): void {
  useAttentionStore.getState().dismissByTarget('ai-chat', conversationId)
}

export function dismissCodingTarget(sessionId: string): void {
  useAttentionStore.getState().dismissByTarget('ai-coding', sessionId)
}

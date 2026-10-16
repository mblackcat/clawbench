import { describe, it, expect, beforeEach } from 'vitest'
import {
  PINNED_SESSIONS_STORAGE_KEY,
  loadPinnedSessionKeys,
  persistPinnedSessionKeys,
  nativePinKey,
  openedPinKey,
  isSessionRowPinned,
  type SidebarSessionRow
} from '../AICodingSidebar'
import type { AICodingSession } from '../../../types/ai-coding'

describe('AICodingSidebar session pinning', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('generates consistent pin keys for native and opened sessions', () => {
    expect(nativePinKey('claude', 'native-123')).toBe('native:claude:native-123')
    expect(openedPinKey('opened-456')).toBe('opened:opened-456')
  })

  it('correctly persists and reloads pinned session keys in localStorage', () => {
    const keys = new Set(['native:claude:s1', 'opened:s2'])
    persistPinnedSessionKeys(keys)

    const raw = localStorage.getItem(PINNED_SESSIONS_STORAGE_KEY)
    expect(raw).toBeTruthy()
    expect(JSON.parse(raw!)).toEqual(['native:claude:s1', 'opened:s2'])

    const reloaded = loadPinnedSessionKeys()
    expect(reloaded.has('native:claude:s1')).toBe(true)
    expect(reloaded.has('opened:s2')).toBe(true)
    expect(reloaded.has('other')).toBe(false)
  })

  it('identifies pinned status across native rows, opened rows, and session map', () => {
    const pinnedKeys = new Set(['native:codex:nat-1', 'opened:op-2'])

    const nativeRow: SidebarSessionRow = {
      key: 'native-codex-nat-1',
      toolType: 'codex',
      title: 'Native session',
      modifiedAt: 100,
      nativeSessionId: 'nat-1'
    }
    expect(isSessionRowPinned(nativeRow, pinnedKeys)).toBe(true)

    const openedRow: SidebarSessionRow = {
      key: 'opened-op-2',
      toolType: 'claude',
      title: 'Opened session',
      modifiedAt: 200,
      openedSessionId: 'op-2'
    }
    expect(isSessionRowPinned(openedRow, pinnedKeys)).toBe(true)

    const unpinnedRow: SidebarSessionRow = {
      key: 'native-gemini-nat-3',
      toolType: 'gemini',
      title: 'Unpinned session',
      modifiedAt: 300,
      nativeSessionId: 'nat-3'
    }
    expect(isSessionRowPinned(unpinnedRow, pinnedKeys)).toBe(false)

    // When session object in store has pinned: true
    const sessionMap = new Map<string, AICodingSession>([
      [
        'op-3',
        {
          id: 'op-3',
          workspaceId: 'ws-1',
          toolType: 'claude',
          source: 'local',
          status: 'idle',
          lastActivity: 'none',
          createdAt: 100,
          updatedAt: 200,
          pinned: true
        }
      ]
    ])
    const storePinnedRow: SidebarSessionRow = {
      key: 'opened-op-3',
      toolType: 'claude',
      title: 'Store pinned',
      modifiedAt: 400,
      openedSessionId: 'op-3'
    }
    expect(isSessionRowPinned(storePinnedRow, new Set(), sessionMap)).toBe(true)
  })

  it('sorts pinned sessions to the top while preserving modifiedAt order within groups', () => {
    const pinnedKeys = new Set(['native:claude:p1', 'opened:p2'])

    const rows: SidebarSessionRow[] = [
      { key: 'u1', toolType: 'claude', title: 'Unpinned 1 (newest)', modifiedAt: 5000, nativeSessionId: 'u1' },
      { key: 'p1', toolType: 'claude', title: 'Pinned 1 (older)', modifiedAt: 2000, nativeSessionId: 'p1' },
      { key: 'u2', toolType: 'claude', title: 'Unpinned 2 (oldest)', modifiedAt: 1000, nativeSessionId: 'u2' },
      { key: 'p2', toolType: 'claude', title: 'Pinned 2 (newer)', modifiedAt: 4000, openedSessionId: 'p2' }
    ]

    const sorted = [...rows].sort((a, b) => {
      const aPinned = isSessionRowPinned(a, pinnedKeys)
      const bPinned = isSessionRowPinned(b, pinnedKeys)
      if (aPinned !== bPinned) return aPinned ? -1 : 1
      return b.modifiedAt - a.modifiedAt
    })

    expect(sorted.map((r) => r.key)).toEqual(['p2', 'p1', 'u1', 'u2'])
  })
})

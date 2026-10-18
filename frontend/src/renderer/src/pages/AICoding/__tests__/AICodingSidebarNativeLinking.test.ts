import { describe, it, expect } from 'vitest'
import {
  resolveNativeSessionLinks,
  sessionTitlesMatch,
  isGenericTitle,
  type SidebarNativeSession
} from '../AICodingSidebar'
import type { AICodingSession } from '../../../types/ai-coding'

describe('AICodingSidebar native session linking', () => {
  it('correctly matches titles and detects generic placeholder titles', () => {
    expect(isGenericTitle(undefined)).toBe(true)
    expect(isGenericTitle('')).toBe(true)
    expect(isGenericTitle('Session a1b2c3d4')).toBe(true)
    expect(isGenericTitle('Claude session')).toBe(true)
    expect(isGenericTitle('Codex 会话')).toBe(true)
    expect(isGenericTitle('Antigravity')).toBe(true)
    expect(isGenericTitle('agy')).toBe(true)
    expect(isGenericTitle('Antigravity session')).toBe(true)
    expect(isGenericTitle('帮我写一个快速排序')).toBe(false)
    expect(isGenericTitle('Fix login bug')).toBe(false)

    expect(sessionTitlesMatch('Fix login bug', 'Fix login bug')).toBe(true)
    expect(sessionTitlesMatch('Fix login bug…', 'Fix login bug')).toBe(true)
    expect(sessionTitlesMatch('Fix login bug', 'Fix login bug with OAuth')).toBe(true)
    expect(sessionTitlesMatch('Fix login bug', 'Implement quicksort')).toBe(false)
    expect(sessionTitlesMatch(undefined, 'Fix login bug')).toBe(false)
  })

  it('prevents a newly opened session from stealing the previous session title (bug fix reproduction)', () => {
    const t0 = 10_000

    // Session 1 started at t0, tool wrote native session at t0 + 500ms
    const session1: AICodingSession = {
      id: 'sess-1',
      workspaceId: 'ws-1',
      toolType: 'grok',
      source: 'local',
      status: 'idle',
      lastActivity: 'none',
      startedAt: t0,
      createdAt: t0,
      updatedAt: t0 + 600
    }

    // Session 2 was opened immediately after at t0 + 1000ms
    const session2: AICodingSession = {
      id: 'sess-2',
      workspaceId: 'ws-1',
      toolType: 'grok',
      source: 'local',
      status: 'idle',
      lastActivity: 'none',
      startedAt: t0 + 1_000,
      createdAt: t0 + 1_000,
      updatedAt: t0 + 1_000
    }

    // Only 1 native session exists on disk (written by/for Session 1 at t0 + 500ms)
    const nativeSessions: SidebarNativeSession[] = [
      {
        sessionId: 'nat-grok-1',
        toolType: 'grok',
        title: 'Session 1: Implement QuickSort',
        modifiedAt: t0 + 500
      }
    ]

    const links = resolveNativeSessionLinks([session1, session2], nativeSessions)

    // Expected: Session 1 claims the native session. Session 2 must NOT claim it or steal its title!
    expect(links).toHaveLength(1)
    expect(links[0].sessionId).toBe('sess-1')
    expect(links[0].toolSessionId).toBe('nat-grok-1')
    expect(links[0].title).toBe('Session 1: Implement QuickSort')
  })

  it('never links an unlaunched session to an existing native session', () => {
    const t0 = 10_000

    // Session 1 is active
    const session1: AICodingSession = {
      id: 'sess-1',
      workspaceId: 'ws-1',
      toolType: 'claude',
      source: 'local',
      status: 'idle',
      lastActivity: 'none',
      startedAt: t0,
      createdAt: t0,
      updatedAt: t0
    }

    // Session 2 was just created via dialog/plus but has not launched yet (closed & no startedAt)
    const session2: AICodingSession = {
      id: 'sess-2',
      workspaceId: 'ws-1',
      toolType: 'claude',
      source: 'local',
      status: 'closed',
      lastActivity: 'none',
      createdAt: t0 + 200,
      updatedAt: t0 + 200
    }

    const nativeSessions: SidebarNativeSession[] = [
      {
        sessionId: 'nat-claude-1',
        toolType: 'claude',
        title: 'Claude prompt 1',
        modifiedAt: t0 + 100
      }
    ]

    const links = resolveNativeSessionLinks([session1, session2], nativeSessions)

    expect(links).toHaveLength(1)
    expect(links[0].sessionId).toBe('sess-1')
  })

  it('prioritizes direct title match when session prompt was already sent', () => {
    const t0 = 10_000

    // Session 1 user typed "Quicksort" -> title set in store
    const session1: AICodingSession = {
      id: 'sess-1',
      workspaceId: 'ws-1',
      toolType: 'codex',
      source: 'local',
      status: 'idle',
      lastActivity: 'none',
      title: 'Quicksort algorithm',
      startedAt: t0,
      createdAt: t0,
      updatedAt: t0 + 3_000
    }

    // Session 2 created at t0 + 2000
    const session2: AICodingSession = {
      id: 'sess-2',
      workspaceId: 'ws-1',
      toolType: 'codex',
      source: 'local',
      status: 'idle',
      lastActivity: 'none',
      startedAt: t0 + 2_000,
      createdAt: t0 + 2_000,
      updatedAt: t0 + 2_000
    }

    // Native session written at t0 + 2500 (numerically closer to Session 2's start time!)
    const nativeSessions: SidebarNativeSession[] = [
      {
        sessionId: 'nat-codex-1',
        toolType: 'codex',
        title: 'Quicksort algorithm in TypeScript',
        modifiedAt: t0 + 2_500
      }
    ]

    const links = resolveNativeSessionLinks([session1, session2], nativeSessions)

    // Title match on Session 1 must win over proximity to Session 2!
    expect(links).toHaveLength(1)
    expect(links[0].sessionId).toBe('sess-1')
    expect(links[0].toolSessionId).toBe('nat-codex-1')
  })

  it('matches multiple active sessions in chronological FIFO order without cross-talk', () => {
    const t0 = 10_000

    const session1: AICodingSession = {
      id: 'sess-1',
      workspaceId: 'ws-1',
      toolType: 'grok',
      source: 'local',
      status: 'idle',
      lastActivity: 'none',
      startedAt: t0,
      createdAt: t0,
      updatedAt: t0
    }

    const session2: AICodingSession = {
      id: 'sess-2',
      workspaceId: 'ws-1',
      toolType: 'grok',
      source: 'local',
      status: 'idle',
      lastActivity: 'none',
      startedAt: t0 + 1_000,
      createdAt: t0 + 1_000,
      updatedAt: t0 + 1_000
    }

    const nativeSessions: SidebarNativeSession[] = [
      {
        sessionId: 'nat-1',
        toolType: 'grok',
        title: 'First Grok Chat',
        modifiedAt: t0 + 500
      },
      {
        sessionId: 'nat-2',
        toolType: 'grok',
        title: 'Second Grok Chat',
        modifiedAt: t0 + 1_500
      }
    ]

    const links = resolveNativeSessionLinks([session1, session2], nativeSessions)

    expect(links).toHaveLength(2)
    const linkMap = new Map(links.map((l) => [l.sessionId, l]))
    expect(linkMap.get('sess-1')?.toolSessionId).toBe('nat-1')
    expect(linkMap.get('sess-1')?.title).toBe('First Grok Chat')
    expect(linkMap.get('sess-2')?.toolSessionId).toBe('nat-2')
    expect(linkMap.get('sess-2')?.title).toBe('Second Grok Chat')
  })

  it('ignores ancient historical sessions that predate all unlinked opened sessions', () => {
    const t0 = 100_000_000

    const session: AICodingSession = {
      id: 'sess-today',
      workspaceId: 'ws-1',
      toolType: 'gemini',
      source: 'local',
      status: 'idle',
      lastActivity: 'none',
      startedAt: t0,
      createdAt: t0,
      updatedAt: t0
    }

    const nativeSessions: SidebarNativeSession[] = [
      {
        sessionId: 'nat-yesterday',
        toolType: 'gemini',
        title: 'Yesterday conversation',
        modifiedAt: t0 - 86_400_000
      }
    ]

    const links = resolveNativeSessionLinks([session], nativeSessions)
    expect(links).toHaveLength(0)
  })

  it('successfully links an antigravity (agy) session and adopts the native title', () => {
    const t0 = 50_000
    const session: AICodingSession = {
      id: 'sess-agy',
      workspaceId: 'ws-1',
      toolType: 'antigravity',
      source: 'local',
      status: 'idle',
      lastActivity: 'none',
      startedAt: t0,
      createdAt: t0,
      updatedAt: t0 + 1_000
    }

    const nativeSessions: SidebarNativeSession[] = [
      {
        sessionId: '78d2ee3e-e697-4a10-bd73-a33b99fe931e',
        toolType: 'antigravity',
        title: '了解项目架构与代码库',
        modifiedAt: t0 + 500
      }
    ]

    const links = resolveNativeSessionLinks([session], nativeSessions)
    expect(links).toHaveLength(1)
    expect(links[0].sessionId).toBe('sess-agy')
    expect(links[0].toolSessionId).toBe('78d2ee3e-e697-4a10-bd73-a33b99fe931e')
    expect(links[0].title).toBe('了解项目架构与代码库')
  })
  it('does not let a new session claim the native history of a session that was just closed', () => {
    const t0 = 10_000

    // Old session: already bound to its native history, closed (tab closed) after the new one started
    const closedOld: AICodingSession = {
      id: 'sess-old',
      workspaceId: 'ws-1',
      toolType: 'claude',
      source: 'local',
      status: 'closed',
      lastActivity: 'none',
      toolSessionId: 'nat-old',
      title: 'Refactor auth flow',
      startedAt: t0 - 60_000,
      createdAt: t0 - 60_000,
      updatedAt: t0 + 1_000
    }

    // New session: running, its own native id not reported yet
    const fresh: AICodingSession = {
      id: 'sess-new',
      workspaceId: 'ws-1',
      toolType: 'claude',
      source: 'local',
      status: 'running',
      lastActivity: 'none',
      startedAt: t0,
      createdAt: t0,
      updatedAt: t0
    }

    // The old native file was touched when the old session was closed
    const nativeSessions: SidebarNativeSession[] = [
      { sessionId: 'nat-old', toolType: 'claude', title: 'Refactor auth flow', modifiedAt: t0 + 1_000 }
    ]

    // The sidebar only links active sessions, but every session claims its own native id
    const links = resolveNativeSessionLinks([fresh], nativeSessions, [closedOld, fresh])
    expect(links).toHaveLength(0)

    // Once the new session's own native history shows up it links to that one instead
    const withOwn = [
      ...nativeSessions,
      { sessionId: 'nat-new', toolType: 'claude' as const, title: 'Add unit tests', modifiedAt: t0 + 3_000 }
    ]
    const later = resolveNativeSessionLinks([fresh], withOwn, [closedOld, fresh])
    expect(later).toEqual([{ sessionId: 'sess-new', toolSessionId: 'nat-new', title: 'Add unit tests' }])
  })
})

import React, { useCallback, useState } from 'react'
import { App, Dropdown, type MenuProps } from 'antd'
import { CopyOutlined, SnippetsOutlined, SelectOutlined, SearchOutlined } from '@ant-design/icons'
import type { Terminal } from '@xterm/xterm'
import { useAICodingStore } from '../../stores/useAICodingStore'
import { dismissCodingTarget } from '../../stores/useAttentionStore'
import type { ClaudeViewMode } from '../../types/ai-coding'
import { useXterm, type XtermHelpers } from '../../hooks/useXterm'
import { getCodingTerminalTheme } from '../../utils/terminal-theme'
import { useSettingsStore } from '../../stores/useSettingsStore'
import TerminalSearchBar from '../../components/TerminalSearchBar'
import { useT } from '../../i18n'

interface CodingTerminalViewProps {
  sessionId: string
  onNewSession: () => void
  onCloseSession?: (sessionId: string) => void
  claudeViewMode?: ClaudeViewMode
  onClaudeViewModeChange?: (mode: ClaudeViewMode) => void
  compact?: boolean
}

/** Tools whose sessions may have been started in SDK (chat) mode and need migrating to a PTY. */
const FORCED_PTY_TOOLS = new Set(['claude', 'codex'])

/**
 * Terminal view for PTY-backed AI tools (Gemini, Codex, Grok, omp, …).
 *
 * These are TUI applications that need a real PTY. The xterm engine, its
 * addons and all the IME/TUI workarounds live in `useXterm`; what remains here
 * is session lifecycle — deciding whether to launch, migrate or re-attach.
 */
const CodingTerminalView: React.FC<CodingTerminalViewProps> = ({ sessionId }) => {
  // Selector-scoped: this view only cares that the session exists. Subscribing
  // to the whole store re-rendered it on every streaming token of every session.
  const sessionExists = useAICodingStore((s) => s.sessions.some((x) => x.id === sessionId))
  const { message } = App.useApp()
  const t = useT()

  const [menuOpen, setMenuOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const currentTheme = useSettingsStore((s) => s.theme)
  const terminalTheme = getCodingTerminalTheme(currentTheme)
  const [searchResults, setSearchResults] = useState({ resultIndex: -1, resultCount: 0 })

  const handleInput = useCallback((data: string) => {
    dismissCodingTarget(sessionId)
    window.api.aiCoding.writePty(sessionId, data)
  }, [sessionId])

  const handleResize = useCallback((cols: number, rows: number) => {
    window.api.aiCoding.resizePty(sessionId, cols, rows)
  }, [sessionId])

  /**
   * Attach to (or start) the PTY behind this session. Output that lands before
   * the buffered replay is queued so it is not interleaved ahead of it.
   */
  const handleReady = useCallback(async (term: Terminal, h: XtermHelpers) => {
    let replayed = false
    const queued: string[] = []
    // Session-scoped subscription: the preload dispatcher only calls us for
    // this session's chunks instead of every terminal seeing every session.
    // Registered synchronously so unmount can always unsubscribe.
    const unsubData = window.api.aiCoding.onPtyData(({ data }) => {
      if (replayed) term.write(data)
      else queued.push(data)
    }, sessionId)
    const timers: number[] = []
    let disposed = false
    h.onDispose(() => {
      disposed = true
      unsubData()
      timers.forEach(window.clearTimeout)
    })

    // Critical for fullscreen TUIs: spawn with the *actual* panel size rather
    // than the 80x24 default — many of them only lay out once, at boot.
    await h.waitForLayout()
    // A mount torn down while waiting (StrictMode double-mount, tab/view switch)
    // must not launch: its spawn races the live mount's and whichever lands last
    // wins — a stale 80-column PTY left the right side blank until a resize.
    if (disposed) return
    h.forceFit()

    const { sessions, launchSession } = useAICodingStore.getState()
    const session = sessions.find((s) => s.id === sessionId)
    const isForcedPtyTool = !!session && FORCED_PTY_TOOLS.has(session.toolType)
    const needsLaunch =
      !session ||
      session.status === 'closed' ||
      session.status === 'completed' ||
      session.status === 'error'

    const fail = (error?: string): void => {
      term.writeln(`\x1b[31mFailed to start session: ${error ?? 'Unknown error'}\x1b[0m`)
    }

    if (needsLaunch) {
      const result = await launchSession(sessionId, {
        forcePty: isForcedPtyTool, cols: term.cols, rows: term.rows
      })
      if (!result.success) fail(result.error)
    } else if (isForcedPtyTool) {
      // Live session. PTY output present means we are just re-attaching after a
      // tab switch — replay and leave the process alone. No output means it was
      // launched in SDK (chat) mode and needs migrating to a PTY.
      const buffered = await window.api.aiCoding.getRawSessionOutput(sessionId)
      if (buffered) {
        term.write(buffered)
      } else {
        try { await window.api.aiCoding.stopSession(sessionId) } catch { /* already stopped */ }
        const result = await launchSession(sessionId, { forcePty: true, cols: term.cols, rows: term.rows })
        if (!result.success) fail(result.error)
      }
    } else {
      const buffered = await window.api.aiCoding.getRawSessionOutput(sessionId)
      if (buffered) term.write(buffered)
    }

    if (disposed) return
    // The panel may have changed size while the launch was in flight.
    h.forceFit()

    // Follow-up resizes so TUIs that only reflow on SIGWINCH pick up the final
    // panel size after React/Allotment layout settles (route re-entry).
    timers.push(...[50, 250, 500].map((ms) => window.setTimeout(() => h.forceFit(), ms)))

    replayed = true
    for (const data of queued.splice(0)) term.write(data)
  }, [sessionId])

  const xterm = useXterm({
    sessionKey: sessionId,
    theme: terminalTheme,
    scrollback: 5000,
    watchVisibility: true,
    onInput: handleInput,
    onResize: handleResize,
    onReady: handleReady,
    onSearchResults: setSearchResults
  })

  const handlePaste = useCallback(async () => {
    const outcome = await xterm.paste()
    if (outcome === 'failed') message.warning(t('terminal.pasteFailed'))
    else if (outcome === 'non-text') message.warning(t('terminal.pasteNonText'))
  }, [xterm, message, t])

  const handleCloseSearch = useCallback(() => {
    setSearchOpen(false)
    xterm.clearSearch()
    xterm.focus()
  }, [xterm])

  // Right-click menu. This is the discoverable path to copying out of a TUI
  // that has mouse tracking on (omp): drag-selection there needs a modifier
  // (Shift, or Option on macOS), which nothing in the UI would otherwise say.
  const menuItems: MenuProps['items'] = [
    { key: 'copy', label: t('terminal.copy'), icon: <CopyOutlined />, onClick: xterm.copy },
    { key: 'paste', label: t('terminal.paste'), icon: <SnippetsOutlined />, onClick: handlePaste },
    { type: 'divider' },
    { key: 'selectAll', label: t('terminal.selectAll'), icon: <SelectOutlined />, onClick: xterm.selectAll },
    { key: 'search', label: t('terminal.search'), icon: <SearchOutlined />, onClick: () => setSearchOpen(true) }
  ]

  if (!sessionExists) return null

  return (
    <Dropdown
      menu={{ items: menuItems }}
      trigger={['contextMenu']}
      open={menuOpen}
      onOpenChange={(open) => {
        setMenuOpen(open)
        // Restore focus to xterm once the menu closes so typing resumes without
        // an extra click. Deferred because paste is async and focus must land
        // after it writes.
        if (!open) setTimeout(() => xterm.focus(), 0)
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'clip' }}>
        <div
          style={{
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            position: 'relative',
            // Match the xterm theme background so letterbox edges don't flash
            // a different colour while resizing.
            background: terminalTheme.background,
            overflow: 'clip'
          }}
        >
          <div
            ref={xterm.containerRef}
            style={{
              position: 'absolute',
              inset: 0,
              overflow: 'clip',
              // No padding: fullscreen TUIs measure cols against the full area
              padding: 0
            }}
          />
          {searchOpen && (
            <TerminalSearchBar
              results={searchResults}
              onFindNext={xterm.findNext}
              onFindPrevious={xterm.findPrevious}
              onClose={handleCloseSearch}
            />
          )}
        </div>
      </div>
    </Dropdown>
  )
}

export default CodingTerminalView

import React, { useCallback, useRef, useState } from 'react'
import { App, Dropdown, type MenuProps } from 'antd'
import {
  CopyOutlined,
  SnippetsOutlined,
  SelectOutlined,
  ClearOutlined,
  SearchOutlined,
} from '@ant-design/icons'
import type { Terminal } from '@xterm/xterm'
import { useAITerminalStore } from '../../stores/useAITerminalStore'
import { useT } from '../../i18n'
import { useXterm, type XtermHelpers } from '../../hooks/useXterm'
import { getShellTerminalTheme } from '../../utils/terminal-theme'
import { useSettingsStore } from '../../stores/useSettingsStore'
import TerminalSearchBar from '../../components/TerminalSearchBar'

interface Props {
  sessionId: string
}

const TerminalPanel: React.FC<Props> = ({ sessionId }) => {
  const t = useT()
  const { message } = App.useApp()

  const disconnectedRef = useRef(false)
  /** Outer wrapper, used purely to anchor the "Copied" toast. */
  const hostRef = useRef<HTMLDivElement>(null)
  /** Set in onReady so input/exit handlers can write status lines. */
  const termRef = useRef<Terminal | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const currentTheme = useSettingsStore((s) => s.theme)
  const terminalTheme = getShellTerminalTheme(currentTheme)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchResults, setSearchResults] = useState({ resultIndex: -1, resultCount: 0 })

  // "Copied" tooltip
  const [copiedTooltip, setCopiedTooltip] = useState<{ visible: boolean; x: number; y: number }>({
    visible: false,
    x: 0,
    y: 0,
  })
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleInput = useCallback((data: string) => {
    // While disconnected, Enter is the reconnect gesture rather than input.
    if (disconnectedRef.current && data.includes('\r')) {
      disconnectedRef.current = false
      termRef.current?.writeln(`\r\n\x1b[33m[${t('terminal.reconnecting')}]\x1b[0m`)
      useAITerminalStore.getState().reconnectTab(sessionId)
      return
    }
    window.api.aiTerminal.writeTerminal(sessionId, data)
  }, [sessionId, t])

  const handleResize = useCallback((cols: number, rows: number) => {
    window.api.aiTerminal.resizeTerminal(sessionId, cols, rows)
  }, [sessionId])

  const handleReady = useCallback(async (term: Terminal, h: XtermHelpers) => {
    termRef.current = term
    h.onDispose(() => { termRef.current = null })
    // Session-scoped subscriptions, registered synchronously so unmount can
    // always tear them down.
    // Live output arriving before the history replay resolves is queued, so it
    // lands after the replay instead of being buried under it.
    let replayed = false
    const queued: string[] = []
    const unsubData = window.api.aiTerminal.onPtyData(({ data }) => {
      if (replayed) term.write(data)
      else queued.push(data)
    }, sessionId)
    const unsubExit = window.api.aiTerminal.onTerminalExit(({ sessionId: sid }) => {
      if (sid !== sessionId) return
      disconnectedRef.current = true
      term.writeln(`\r\n\x1b[33m[${t('terminal.disconnectedHint')}]\x1b[0m`)
    })
    h.onDispose(() => {
      unsubData()
      unsubExit()
    })

    // Replay the PTY ring buffer so a module switch / remount keeps history.
    const buffered = await window.api.aiTerminal.getRawTerminalOutput(sessionId)
    if (buffered) term.write(buffered)
    replayed = true
    for (const data of queued.splice(0)) term.write(data)
    h.fit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  const handleSelection = useCallback((text: string) => {
    useAITerminalStore.getState().setSelectedText(text)
    // Show a "Copied" toast near the top of the terminal — selection already
    // lands on the clipboard inside useXterm.
    const el = hostRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setCopiedTooltip({ visible: true, x: rect.left + rect.width / 2, y: rect.top + 12 })
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
    copiedTimerRef.current = setTimeout(() => {
      setCopiedTooltip((prev) => ({ ...prev, visible: false }))
    }, 1200)
  }, [])

  const xterm = useXterm({
    sessionKey: sessionId,
    theme: terminalTheme,
    scrollback: 10000,
    onInput: handleInput,
    onResize: handleResize,
    onReady: handleReady,
    onSelection: handleSelection,
    onSearchResults: setSearchResults,
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

  const menuItems: MenuProps['items'] = [
    { key: 'copy', label: t('terminal.copy'), icon: <CopyOutlined />, onClick: xterm.copy },
    { key: 'paste', label: t('terminal.paste'), icon: <SnippetsOutlined />, onClick: handlePaste },
    { type: 'divider' },
    { key: 'selectAll', label: t('terminal.selectAll'), icon: <SelectOutlined />, onClick: xterm.selectAll },
    { key: 'clear', label: t('terminal.clear'), icon: <ClearOutlined />, onClick: xterm.clear },
    { type: 'divider' },
    { key: 'search', label: t('terminal.search'), icon: <SearchOutlined />, onClick: () => setSearchOpen(true) },
  ]

  return (
    <Dropdown
      menu={{ items: menuItems }}
      trigger={['contextMenu']}
      open={menuOpen}
      onOpenChange={(open) => {
        setMenuOpen(open)
        // Restore focus to xterm when the menu closes so typing resumes without
        // an extra click. Deferred so antd finishes tearing the dropdown down
        // first — otherwise its own cleanup steals focus straight back.
        if (!open) requestAnimationFrame(() => xterm.focus())
      }}
    >
      <div
        ref={hostRef}
        style={{
          width: '100%',
          height: '100%',
          position: 'relative',
          background: terminalTheme.background,
        }}
      >
        {/* xterm container — must have NO React children so xterm can measure cols/rows correctly */}
        <div
          ref={xterm.containerRef}
          style={{
            position: 'absolute',
            inset: 0,
            overflow: 'hidden',
            padding: '4px 0 0 4px',
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
        {/* Copied tooltip — rendered outside the xterm container */}
        {copiedTooltip.visible && (
          <div
            style={{
              position: 'fixed',
              left: copiedTooltip.x,
              top: copiedTooltip.y,
              transform: 'translateX(-50%)',
              background: 'rgba(0,0,0,0.75)',
              color: '#fff',
              padding: '4px 12px',
              borderRadius: 4,
              fontSize: 12,
              pointerEvents: 'none',
              zIndex: 10000,
              whiteSpace: 'nowrap',
            }}
          >
            {t('terminal.copied')}
          </div>
        )}
      </div>
    </Dropdown>
  )
}

export default TerminalPanel

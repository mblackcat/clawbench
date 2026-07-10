import React, { useEffect, useRef, useState, useCallback } from 'react'
import { App, Dropdown, type MenuProps } from 'antd'
import {
  CopyOutlined,
  SnippetsOutlined,
  SelectOutlined,
  ClearOutlined,
  SearchOutlined,
} from '@ant-design/icons'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { useAITerminalStore } from '../../stores/useAITerminalStore'
import { useT } from '../../i18n'

interface Props {
  sessionId: string
}

const TerminalPanel: React.FC<Props> = ({ sessionId }) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const sessionIdRef = useRef(sessionId)
  sessionIdRef.current = sessionId
  const disconnectedRef = useRef(false)
  const t = useT()
  const { message } = App.useApp()

  // Copied tooltip state
  const [copiedTooltip, setCopiedTooltip] = useState<{ visible: boolean; x: number; y: number }>({
    visible: false,
    x: 0,
    y: 0,
  })
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Right-click menu position state
  const [menuOpen, setMenuOpen] = useState(false)

  const handleCopy = useCallback(() => {
    const term = termRef.current
    if (!term) return
    const selection = term.getSelection()
    if (selection) {
      navigator.clipboard.writeText(selection)
    }
  }, [])

  const handlePaste = useCallback(async () => {
    const term = termRef.current
    if (!term) return
    try {
      const text = await navigator.clipboard.readText()
      if (text) {
        window.api.aiTerminal.writeTerminal(sessionIdRef.current, text)
        return
      }
      // readText() returned empty — clipboard may contain non-text (image/file) or be empty.
      // Probe clipboard items to distinguish and warn only when non-text payload exists.
      try {
        const items = await navigator.clipboard.read()
        const hasNonText = items.some(
          (item) => !item.types.some((tp) => tp === 'text/plain')
        )
        if (hasNonText) {
          message.warning(t('terminal.pasteNonText'))
        }
      } catch {
        // ignore — clipboard.read() may not be supported or permission denied
      }
    } catch {
      message.warning(t('terminal.pasteFailed'))
    }
  }, [message, t])

  const handleSelectAll = useCallback(() => {
    const term = termRef.current
    if (!term) return
    term.selectAll()
  }, [])

  const handleClear = useCallback(() => {
    const term = termRef.current
    if (!term) return
    term.clear()
  }, [])

  // Context menu items
  const menuItems: MenuProps['items'] = [
    {
      key: 'copy',
      label: t('terminal.copy'),
      icon: <CopyOutlined />,
      onClick: handleCopy,
    },
    {
      key: 'paste',
      label: t('terminal.paste'),
      icon: <SnippetsOutlined />,
      onClick: handlePaste,
    },
    { type: 'divider' },
    {
      key: 'selectAll',
      label: t('terminal.selectAll'),
      icon: <SelectOutlined />,
      onClick: handleSelectAll,
    },
    {
      key: 'clear',
      label: t('terminal.clear'),
      icon: <ClearOutlined />,
      onClick: handleClear,
    },
    { type: 'divider' },
    {
      key: 'search',
      label: t('terminal.search'),
      icon: <SearchOutlined />,
      disabled: true,
    },
  ]

  useEffect(() => {
    if (!containerRef.current) return

    const term = new Terminal({
      fontFamily: '"MesloLGS NF", "CaskaydiaCove Nerd Font", "FiraCode Nerd Font", "JetBrainsMono Nerd Font", "Cascadia Code", "Fira Code", "JetBrains Mono", monospace',
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
      cursorStyle: 'bar',
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#d4d4d4',
        selectionBackground: '#264f78',
        black: '#1e1e1e',
        red: '#f44747',
        green: '#6a9955',
        yellow: '#dcdcaa',
        blue: '#569cd6',
        magenta: '#c678dd',
        cyan: '#56b6c2',
        white: '#d4d4d4',
        brightBlack: '#808080',
        brightRed: '#f44747',
        brightGreen: '#6a9955',
        brightYellow: '#dcdcaa',
        brightBlue: '#569cd6',
        brightMagenta: '#c678dd',
        brightCyan: '#56b6c2',
        brightWhite: '#ffffff',
      },
      scrollback: 10000,
      allowProposedApi: true,
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)

    // WebLinksAddon — make URLs clickable
    const webLinksAddon = new WebLinksAddon((_event, uri) => {
      window.open(uri, '_blank')
    })
    term.loadAddon(webLinksAddon)

    term.open(containerRef.current)

    // Restore buffered output from PTY (handles module switch remount)
    window.api.aiTerminal.getRawTerminalOutput(sessionId).then((buffered) => {
      if (buffered) {
        term.write(buffered)
      }
    })

    requestAnimationFrame(() => {
      fitAddon.fit()
    })

    // The terminal's custom fontFamily (Nerd Fonts) may still be resolving
    // when xterm.js first measures character-cell width at mount. Since
    // xterm only re-measures cell width when the fontFamily/fontSize
    // *option* changes (not when the browser actually finishes loading the
    // font), a late-resolving font leaves the cached cell width mismatched
    // against the glyphs actually rendered — which throws off xterm's
    // click-to-column math and makes drag-selection feel like it needs an
    // extra column before the last character under the cursor gets
    // included. Re-fit and force a full repaint once fonts are ready so
    // the cell-width measurement matches what's on screen.
    document.fonts.ready.then(() => {
      if (termRef.current !== term) return
      fitAddon.fit()
      term.refresh(0, term.rows - 1)
    })

    termRef.current = term
    fitAddonRef.current = fitAddon

    // Suppress keydown events during IME composition to prevent double input
    // when switching between Chinese and English input methods
    const isMac = window.api.platform === 'darwin'
    term.attachCustomKeyEventHandler((event) => {
      if (event.type === 'keydown' && (event.isComposing || event.keyCode === 229)) {
        return false
      }
      // Paste shortcut: Cmd+V on macOS, Ctrl+V on Windows/Linux.
      // We intercept keydown AND call preventDefault so the browser does not
      // also fire its native `paste` event (which xterm's hidden textarea
      // listens for) — otherwise the clipboard text gets written twice.
      if (event.type === 'keydown' && (event.key === 'v' || event.key === 'V')) {
        const matchesPaste = isMac
          ? event.metaKey && !event.ctrlKey && !event.altKey
          : event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey
        if (matchesPaste) {
          event.preventDefault()
          handlePaste()
          return false
        }
      }
      return true
    })

    // Forward keyboard input to PTY
    term.onData((data) => {
      if (disconnectedRef.current && data.includes('\r')) {
        disconnectedRef.current = false
        term.writeln(`\r\n\x1b[33m[${t('terminal.reconnecting')}]\x1b[0m`)
        useAITerminalStore.getState().reconnectTab(sessionIdRef.current)
        return
      }
      window.api.aiTerminal.writeTerminal(sessionIdRef.current, data)
    })

    // Handle text selection — auto-copy + tooltip
    term.onSelectionChange(() => {
      const selection = term.getSelection()
      if (selection) {
        useAITerminalStore.getState().setSelectedText(selection)
        // Auto-copy to clipboard
        navigator.clipboard.writeText(selection)
        // Show "Copied" tooltip near the terminal cursor area
        const el = containerRef.current
        if (el) {
          const rect = el.getBoundingClientRect()
          // Position tooltip near center-top of the terminal container
          setCopiedTooltip({
            visible: true,
            x: rect.left + rect.width / 2,
            y: rect.top + 12,
          })
          if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
          copiedTimerRef.current = setTimeout(() => {
            setCopiedTooltip((prev) => ({ ...prev, visible: false }))
          }, 1200)
        }
      }
    })

    // Subscribe to PTY data
    const unsubData = window.api.aiTerminal.onPtyData(({ sessionId: sid, data }) => {
      if (sid === sessionIdRef.current) {
        term.write(data)
      }
    })

    // Listen for terminal exit — show reconnect hint
    const unsubExit = window.api.aiTerminal.onTerminalExit(({ sessionId: sid }) => {
      if (sid === sessionIdRef.current) {
        disconnectedRef.current = true
        term.writeln(`\r\n\x1b[33m[${t('terminal.disconnectedHint')}]\x1b[0m`)
      }
    })

    // Resize handler
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit()
      if (termRef.current) {
        window.api.aiTerminal.resizeTerminal(
          sessionIdRef.current,
          termRef.current.cols,
          termRef.current.rows
        )
      }
    })
    resizeObserver.observe(containerRef.current)

    return () => {
      unsubData()
      unsubExit()
      resizeObserver.disconnect()
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
      term.dispose()
      termRef.current = null
      fitAddonRef.current = null
    }
  }, [sessionId])

  return (
    <Dropdown
      menu={{ items: menuItems }}
      trigger={['contextMenu']}
      open={menuOpen}
      onOpenChange={(open) => {
        setMenuOpen(open)
        // When the context menu closes (item clicked or dismissed), restore
        // focus to xterm so the user can type immediately without an extra
        // click into the terminal area.
        if (!open) {
          // Defer: paste handler is async, and focus must be re-applied AFTER
          // antd finishes tearing down the dropdown — otherwise the dropdown's
          // own blur/cleanup steals focus right back.
          requestAnimationFrame(() => {
            termRef.current?.focus()
          })
        }
      }}
    >
      <div
        style={{
          width: '100%',
          height: '100%',
          position: 'relative',
          background: '#1e1e1e',
        }}
      >
        {/* xterm container — must have NO React children so xterm can measure cols/rows correctly */}
        <div
          ref={containerRef}
          style={{
            position: 'absolute',
            inset: 0,
            overflow: 'hidden',
            padding: '4px 0 0 4px',
          }}
        />
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

import React, { useEffect, useRef, useMemo } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { useAIWorkbenchStore } from '../../stores/useAIWorkbenchStore'
import type { ClaudeViewMode } from '../../types/ai-workbench'

interface WorkbenchTerminalViewProps {
  sessionId: string
  onNewSession: () => void
  onCloseSession?: (sessionId: string) => void
  claudeViewMode?: ClaudeViewMode
  onClaudeViewModeChange?: (mode: ClaudeViewMode) => void
}

/**
 * Terminal view for non-Claude AI tools (Gemini, Codex, OpenCode, Qwen, etc.).
 *
 * These tools are TUI-based applications that require a real PTY to function.
 * This component renders the raw PTY output via xterm.js and sends keyboard
 * input directly to the PTY process — providing a full embedded terminal
 * experience within the workbench panel.
 */
const WorkbenchTerminalView: React.FC<WorkbenchTerminalViewProps> = ({ sessionId }) => {
  const { sessions, launchSession } = useAIWorkbenchStore()

  const session = useMemo(() => sessions.find(s => s.id === sessionId), [sessions, sessionId])

  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const sessionIdRef = useRef(sessionId)
  sessionIdRef.current = sessionId

  useEffect(() => {
    if (!containerRef.current) return

    const term = new Terminal({
      fontFamily: '"Cascadia Code", "Fira Code", "JetBrains Mono", monospace',
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
      scrollback: 5000,
      allowProposedApi: true,
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(containerRef.current)

    const fitTimer = setTimeout(() => {
      fitAddon.fit()
      window.api.aiWorkbench.resizePty(sessionIdRef.current, term.cols, term.rows)
    }, 100)

    termRef.current = term
    fitAddonRef.current = fitAddon

    term.attachCustomKeyEventHandler((event) => {
      if (event.type === 'keydown' && (event.isComposing || event.keyCode === 229)) {
        return false
      }
      return true
    })

    term.onData((data) => {
      window.api.aiWorkbench.writePty(sessionIdRef.current, data)
    })

    const unsubData = window.api.aiWorkbench.onPtyData(({ sessionId: sid, data }) => {
      if (sid === sessionIdRef.current) {
        term.write(data)
      }
    })

    const currentSession = useAIWorkbenchStore.getState().sessions.find(s => s.id === sessionId)
    const isClaude = currentSession?.toolType === 'claude'
    const needsLaunch =
      !currentSession ||
      currentSession.status === 'closed' ||
      currentSession.status === 'completed' ||
      currentSession.status === 'error'

    if (isClaude) {
      const doLaunch = async (): Promise<void> => {
        if (!needsLaunch) {
          try { await window.api.aiWorkbench.stopSession(sessionId) } catch { /* */ }
        }
        const result = await launchSession(sessionId, { forcePty: true })
        if (!result.success) {
          term.writeln(`\x1b[31mFailed to start session: ${result.error ?? 'Unknown error'}\x1b[0m`)
        }
      }
      doLaunch()
    } else if (needsLaunch) {
      launchSession(sessionId).then(result => {
        if (!result.success) {
          term.writeln(`\x1b[31mFailed to start session: ${result.error ?? 'Unknown error'}\x1b[0m`)
        }
      })
    }

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit()
      if (termRef.current) {
        window.api.aiWorkbench.resizePty(sessionIdRef.current, termRef.current.cols, termRef.current.rows)
      }
    })
    resizeObserver.observe(containerRef.current)

    return () => {
      clearTimeout(fitTimer)
      unsubData()
      resizeObserver.disconnect()
      term.dispose()
      termRef.current = null
      fitAddonRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  if (!session) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div
        ref={containerRef}
        style={{
          flex: 1,
          overflow: 'hidden',
          padding: '4px 0 0 4px',
          background: '#1e1e1e',
        }}
      />
    </div>
  )
}

export default WorkbenchTerminalView

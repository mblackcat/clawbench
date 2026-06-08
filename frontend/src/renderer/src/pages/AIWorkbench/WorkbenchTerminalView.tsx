import React, { useEffect, useRef, useMemo } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { useAIWorkbenchStore } from '../../stores/useAIWorkbenchStore'
import type { ClaudeViewMode } from '../../types/ai-workbench'

interface WorkbenchTerminalViewProps {
  sessionId: string
  onNewSession: () => void
  onCloseSession?: (sessionId: string) => void
  claudeViewMode?: ClaudeViewMode
  onClaudeViewModeChange?: (mode: ClaudeViewMode) => void
  compact?: boolean
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
    term.loadAddon(new WebLinksAddon((_event, uri) => window.open(uri, '_blank')))
    term.open(containerRef.current)

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

    let replayed = false
    const queuedData: string[] = []
    const unsubData = window.api.aiWorkbench.onPtyData(({ sessionId: sid, data }) => {
      if (sid === sessionIdRef.current) {
        if (replayed) term.write(data)
        else queuedData.push(data)
      }
    })

    const fitAndResize = (): void => {
      try {
        fitAddon.fit()
        window.api.aiWorkbench.resizePty(sessionIdRef.current, term.cols, term.rows)
      } catch {
        // xterm-fit can throw while the container is not measurable.
      }
    }

    const startOrAttach = async (): Promise<void> => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      fitAndResize()

      const currentSession = useAIWorkbenchStore.getState().sessions.find(s => s.id === sessionId)
      const isClaude = currentSession?.toolType === 'claude'
      const needsLaunch =
        !currentSession ||
        currentSession.status === 'closed' ||
        currentSession.status === 'completed' ||
        currentSession.status === 'error'

      if (isClaude) {
        if (!needsLaunch) {
          try { await window.api.aiWorkbench.stopSession(sessionId) } catch { /* */ }
        }
        const result = await launchSession(sessionId, { forcePty: true, cols: term.cols, rows: term.rows })
        if (!result.success) {
          term.writeln(`\x1b[31mFailed to start session: ${result.error ?? 'Unknown error'}\x1b[0m`)
        }
      } else if (needsLaunch) {
        const result = await launchSession(sessionId, { cols: term.cols, rows: term.rows })
        if (!result.success) {
          term.writeln(`\x1b[31mFailed to start session: ${result.error ?? 'Unknown error'}\x1b[0m`)
        }
      } else {
        const buffered = await window.api.aiWorkbench.getRawSessionOutput(sessionId)
        if (buffered) term.write(buffered)
      }

      replayed = true
      for (const data of queuedData.splice(0)) term.write(data)
    }
    startOrAttach()

    const resizeObserver = new ResizeObserver(() => {
      fitAndResize()
    })
    resizeObserver.observe(containerRef.current)

    return () => {
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

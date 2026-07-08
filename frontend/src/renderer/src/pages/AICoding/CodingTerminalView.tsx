import React, { useEffect, useRef, useMemo } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { useAICodingStore } from '../../stores/useAICodingStore'
import type { ClaudeViewMode } from '../../types/ai-coding'

interface CodingTerminalViewProps {
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
const CodingTerminalView: React.FC<CodingTerminalViewProps> = ({ sessionId }) => {
  const { sessions, launchSession } = useAICodingStore()

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
      cursorBlink: false,
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

    // xterm's hidden helper textarea accumulates committed IME text across
    // successive compositions. The OS IME anchors its candidate popup at
    // the textarea's caret — after a commit, that caret sits at the end of
    // the accumulated text, so the next Chinese composition's popup floats
    // to wherever the text ends instead of the cursor cell where xterm just
    // repositioned the textarea.
    //
    // Clear the textarea value at compositionstart in the CAPTURE phase so
    // it runs BEFORE xterm's bubble-phase listener (which records
    // `compositionPosition.start = textarea.value.length`). xterm then sees
    // start=0, pulls the full composition text via value.substring(0, end)
    // at compositionend, and the caret stays at offset 0 — so the IME popup
    // anchors at the textarea origin = cursor cell.
    const helperTextarea = containerRef.current.querySelector('.xterm-helper-textarea') as HTMLTextAreaElement | null
    const handleCompositionStart = (): void => {
      if (helperTextarea && helperTextarea.value !== '') {
        helperTextarea.value = ''
      }
    }
    helperTextarea?.addEventListener('compositionstart', handleCompositionStart, true)

    // Lock the IME textarea position once we've seen a correct anchor.
    //
    // TUIs like Claude Code redraw a status line at the bottom of the
    // viewport on every input — that leaves xterm's tracked cursor
    // (`buffer.x/y`) at the bottom-right, even though Claude's *visible*
    // cursor stays in the input box (Claude draws a reverse-video block
    // and parks the real cursor elsewhere). xterm's
    // `CompositionHelper.updateCompositionElements` reads `buffer.x/y` to
    // place the textarea, so the OS IME popup follows the redrawn cursor
    // instead of the visible one.
    //
    // We can't know where Claude visually renders its cursor — so we
    // remember the textarea position from the first composition (which
    // is anchored to the user's actual typing spot) and snap subsequent
    // compositions back to that same position via a MutationObserver on
    // the textarea's inline style.
    let lockedLeft: string | null = null
    let lockedTop: string | null = null
    let suppressMutation = false
    const styleObserver = helperTextarea
      ? new MutationObserver(() => {
          if (suppressMutation || lockedLeft === null || !helperTextarea) return
          if (helperTextarea.style.left !== lockedLeft || helperTextarea.style.top !== lockedTop) {
            suppressMutation = true
            helperTextarea.style.left = lockedLeft
            helperTextarea.style.top = lockedTop!
            suppressMutation = false
          }
        })
      : null
    styleObserver?.observe(helperTextarea!, { attributes: true, attributeFilter: ['style'] })
    const handleCompositionUpdate = (): void => {
      // Capture xterm's chosen position on the first composition only — that
      // first frame is anchored to the real input cursor. Subsequent updates
      // get snapped back by the MutationObserver above.
      if (lockedLeft === null && helperTextarea && helperTextarea.style.left) {
        lockedLeft = helperTextarea.style.left
        lockedTop = helperTextarea.style.top
      }
    }
    helperTextarea?.addEventListener('compositionupdate', handleCompositionUpdate)
    // User click into the terminal means they may want to type at a new
    // position — release the lock so the next composition re-captures.
    const handleClickReset = (): void => {
      lockedLeft = null
      lockedTop = null
    }
    containerRef.current.addEventListener('mousedown', handleClickReset)
    const containerEl = containerRef.current

    termRef.current = term
    fitAddonRef.current = fitAddon

    term.attachCustomKeyEventHandler((event) => {
      if (event.type === 'keydown' && (event.isComposing || event.keyCode === 229)) {
        return false
      }
      // Paste shortcut: Cmd+V on macOS, Ctrl+V on Windows/Linux.
      // We intercept keydown and preventDefault so the browser does not also
      // fire its native `paste` event (which xterm's hidden textarea listens
      // for) — otherwise the clipboard text would be written twice.
      if (event.type === 'keydown' && (event.key === 'v' || event.key === 'V')) {
        const isMac = window.api.platform === 'darwin'
        const matchesPaste = isMac
          ? event.metaKey && !event.ctrlKey && !event.altKey
          : event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey
        if (matchesPaste) {
          event.preventDefault()
          navigator.clipboard.readText().then((text) => {
            if (text) window.api.aiCoding.writePty(sessionIdRef.current, text)
          }).catch(() => { /* clipboard read denied or empty */ })
          return false
        }
      }
      return true
    })

    term.onData((data) => {
      window.api.aiCoding.writePty(sessionIdRef.current, data)
    })

    let replayed = false
    const queuedData: string[] = []
    const unsubData = window.api.aiCoding.onPtyData(({ sessionId: sid, data }) => {
      if (sid === sessionIdRef.current) {
        if (replayed) term.write(data)
        else queuedData.push(data)
      }
    })

    const fitAndResize = (): void => {
      try {
        fitAddon.fit()
        window.api.aiCoding.resizePty(sessionIdRef.current, term.cols, term.rows)
      } catch {
        // xterm-fit can throw while the container is not measurable.
      }
    }

    const startOrAttach = async (): Promise<void> => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      fitAndResize()

      const currentSession = useAICodingStore.getState().sessions.find(s => s.id === sessionId)
      const needsForcedPty = currentSession?.toolType === 'claude' || currentSession?.toolType === 'codex'
      const needsLaunch =
        !currentSession ||
        currentSession.status === 'closed' ||
        currentSession.status === 'completed' ||
        currentSession.status === 'error'

      if (needsForcedPty) {
        if (!needsLaunch) {
          // Session exists and is not in a terminal state. Check if it already
          // has PTY output (meaning it's already running in PTY mode, e.g. we
          // are reconnecting after a tab switch). If so, just re-attach instead
          // of stopping and relaunching — which would kill the working session.
          const buffered = await window.api.aiCoding.getRawSessionOutput(sessionId)
          if (!buffered) {
            // No PTY output — session was launched in SDK (chat) mode and needs
            // migration to PTY mode for the terminal view.
            try { await window.api.aiCoding.stopSession(sessionId) } catch { /* */ }
            const result = await launchSession(sessionId, { forcePty: true, cols: term.cols, rows: term.rows })
            if (!result.success) {
              term.writeln(`\x1b[31mFailed to start session: ${result.error ?? 'Unknown error'}\x1b[0m`)
            }
          } else {
            // Session is already running in PTY mode — just replay buffered output
            term.write(buffered)
          }
        } else {
          const result = await launchSession(sessionId, { forcePty: true, cols: term.cols, rows: term.rows })
          if (!result.success) {
            term.writeln(`\x1b[31mFailed to start session: ${result.error ?? 'Unknown error'}\x1b[0m`)
          }
        }
      } else if (needsLaunch) {
        const result = await launchSession(sessionId, { cols: term.cols, rows: term.rows })
        if (!result.success) {
          term.writeln(`\x1b[31mFailed to start session: ${result.error ?? 'Unknown error'}\x1b[0m`)
        }
      } else {
        const buffered = await window.api.aiCoding.getRawSessionOutput(sessionId)
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

    // During IME composition (Chinese input with candidate popup), xterm
    // repositions its hidden helper textarea to the cursor and grows its
    // width to fit the composition text. Once the textarea overflows the
    // viewport on the second composition, the browser fires scrollIntoView
    // on the focused textarea and sets scrollLeft on every scrollable
    // ancestor — `overflow: hidden` does NOT block that. The entire TUI
    // gets shifted sideways as a result. We listen on the capture phase and
    // reset scroll on the xterm root + our wrappers as soon as it happens.
    const innerEl = containerRef.current
    const wrapperEl = innerEl.parentElement
    const outerEl = wrapperEl?.parentElement ?? null
    const xtermRoot = innerEl.querySelector('.xterm') as HTMLElement | null
    const scrollTargets: HTMLElement[] = [innerEl]
    if (wrapperEl) scrollTargets.push(wrapperEl)
    if (outerEl) scrollTargets.push(outerEl)
    if (xtermRoot) scrollTargets.push(xtermRoot)
    const resetScroll = (): void => {
      for (const el of scrollTargets) {
        if (el.scrollLeft !== 0) el.scrollLeft = 0
        if (el.scrollTop !== 0) el.scrollTop = 0
      }
    }
    for (const el of scrollTargets) {
      el.addEventListener('scroll', resetScroll, { capture: true, passive: true })
    }

    return () => {
      unsubData()
      resizeObserver.disconnect()
      helperTextarea?.removeEventListener('compositionstart', handleCompositionStart, true)
      helperTextarea?.removeEventListener('compositionupdate', handleCompositionUpdate)
      styleObserver?.disconnect()
      containerEl.removeEventListener('mousedown', handleClickReset)
      for (const el of scrollTargets) {
        el.removeEventListener('scroll', resetScroll, { capture: true })
      }
      term.dispose()
      termRef.current = null
      fitAddonRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  if (!session) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'clip' }}>
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, position: 'relative', background: '#1e1e1e', overflow: 'clip' }}>
        <div
          ref={containerRef}
          style={{
            position: 'absolute',
            inset: 0,
            overflow: 'clip',
            padding: '4px 0 0 4px',
          }}
        />
      </div>
    </div>
  )
}

export default CodingTerminalView

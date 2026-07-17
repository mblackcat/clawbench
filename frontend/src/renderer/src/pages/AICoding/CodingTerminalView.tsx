import React, { useEffect, useRef, useMemo } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { useAICodingStore } from '../../stores/useAICodingStore'
import type { ClaudeViewMode } from '../../types/ai-coding'
import { MONO_FONT_STACK } from '../../utils/mono-font'

interface CodingTerminalViewProps {
  sessionId: string
  onNewSession: () => void
  onCloseSession?: (sessionId: string) => void
  claudeViewMode?: ClaudeViewMode
  onClaudeViewModeChange?: (mode: ClaudeViewMode) => void
  compact?: boolean
}

/**
 * Default dark palette aligned with Windows Terminal / VS Code Dark+.
 * `black` matches `background` so TUI tools that paint "default bg" vs
 * "ANSI black" (Grok panels / input chrome) don't leave mismatched bands.
 */
const XTERM_DARK_THEME = {
  background: '#0c0c0c',
  foreground: '#cccccc',
  cursor: '#ffffff',
  cursorAccent: '#0c0c0c',
  selectionBackground: '#264f78',
  black: '#0c0c0c',
  red: '#c50f1f',
  green: '#13a10e',
  yellow: '#c19c00',
  blue: '#0037da',
  magenta: '#881798',
  cyan: '#3a96dd',
  white: '#cccccc',
  brightBlack: '#767676',
  brightRed: '#e74856',
  brightGreen: '#16c60c',
  brightYellow: '#f9f1a5',
  brightBlue: '#3b78ff',
  brightMagenta: '#b4009e',
  brightCyan: '#61d6d6',
  brightWhite: '#f2f2f2'
}

/**
 * Terminal view for non-Claude AI tools (Gemini, Codex, OpenCode, Grok, etc.).
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
      fontFamily: MONO_FONT_STACK,
      fontSize: 13,
      lineHeight: 1.2,
      letterSpacing: 0,
      cursorBlink: true,
      cursorStyle: 'bar',
      // Fullscreen TUIs (Grok) draw to every cell — don't add visual padding
      // that makes cols measure different from the painted surface.
      theme: XTERM_DARK_THEME,
      scrollback: 5000,
      allowProposedApi: true,
      // Avoid converting lone \n → \r\n which some ConPTY-hosted TUIs already emit correctly
      convertEol: false
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

    // Re-measure character cell size once the terminal's fontFamily has
    // actually resolved. xterm.js only re-runs its cell-width measurement
    // when the fontFamily/fontSize *option* changes, not when the browser
    // finishes loading a font — so if the intended font resolves after
    // xterm's first measurement, the cached cell width no longer matches
    // the rendered glyphs, which throws off drag-selection's click-to-column
    // math (last character under the cursor needs an extra column of drag
    // before it's included in the selection).
    document.fonts.ready.then(() => {
      if (termRef.current !== term) return
      try {
        fitAddon.fit()
        term.refresh(0, term.rows - 1)
        window.api.aiCoding.resizePty(sessionIdRef.current, term.cols, term.rows)
      } catch { /* ignore */ }
    })

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

    let lastCols = 0
    let lastRows = 0
    const fitAndResize = (): void => {
      try {
        fitAddon.fit()
        if (term.cols > 0 && term.rows > 0) {
          // Always tell the PTY when the measured size changes. Also re-notify
          // on equal sizes after a delayed re-fit so TUIs that missed the first
          // SIGWINCH (common after route re-entry) still reflow.
          const sizeChanged = term.cols !== lastCols || term.rows !== lastRows
          lastCols = term.cols
          lastRows = term.rows
          if (sizeChanged) {
            window.api.aiCoding.resizePty(sessionIdRef.current, term.cols, term.rows)
          }
        }
      } catch {
        // xterm-fit can throw while the container is not measurable.
      }
    }

    /** Force PTY resize even when cols/rows are unchanged (post-visibility). */
    const forceFitAndResize = (): void => {
      try {
        fitAddon.fit()
        if (term.cols > 0 && term.rows > 0) {
          lastCols = term.cols
          lastRows = term.rows
          window.api.aiCoding.resizePty(sessionIdRef.current, term.cols, term.rows)
          term.refresh(0, term.rows - 1)
        }
      } catch {
        // ignore until measurable
      }
    }

    /** Wait until the container has a real layout size (not 0×0). */
    const waitForLayout = async (maxFrames = 30): Promise<void> => {
      for (let i = 0; i < maxFrames; i++) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
        const el = containerRef.current
        if (el && el.clientWidth > 40 && el.clientHeight > 40) {
          fitAndResize()
          // Require a non-default cols measurement (FitAddon needs measurable font metrics)
          if (term.cols >= 20 && term.rows >= 5) return
        }
      }
      fitAndResize()
    }

    const startOrAttach = async (): Promise<void> => {
      // Critical for Grok/fullscreen TUIs: spawn with the *actual* panel size,
      // not the 80×24 default — many TUIs only layout once at boot.
      await waitForLayout()
      forceFitAndResize()

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

      // Push follow-up resizes so TUIs that only reflow on SIGWINCH pick up the
      // final panel size after React/Allotment layout settles (route re-entry).
      window.setTimeout(() => forceFitAndResize(), 50)
      window.setTimeout(() => forceFitAndResize(), 250)
      window.setTimeout(() => forceFitAndResize(), 500)

      replayed = true
      for (const data of queuedData.splice(0)) term.write(data)
    }
    startOrAttach()

    const resizeObserver = new ResizeObserver(() => {
      fitAndResize()
    })
    resizeObserver.observe(containerRef.current)

    // Window resize (also fired by AICodingPage after route re-entry) and
    // visibility restore — covers cases where the container box is correct but
    // xterm/PTY still hold a stale col count from a prior measurement.
    const onWindowResize = (): void => { forceFitAndResize() }
    window.addEventListener('resize', onWindowResize)

    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') forceFitAndResize()
    }
    document.addEventListener('visibilitychange', onVisibility)

    const intersectionObserver = typeof IntersectionObserver !== 'undefined'
      ? new IntersectionObserver((entries) => {
          if (entries.some((e) => e.isIntersecting && e.intersectionRatio > 0)) {
            forceFitAndResize()
          }
        }, { threshold: [0, 0.01, 1] })
      : null
    intersectionObserver?.observe(containerRef.current)

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
      intersectionObserver?.disconnect()
      window.removeEventListener('resize', onWindowResize)
      document.removeEventListener('visibilitychange', onVisibility)
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
      <div
        style={{
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          position: 'relative',
          // Match xterm theme background so letterbox edges don't flash a different color
          background: XTERM_DARK_THEME.background,
          overflow: 'clip'
        }}
      >
        <div
          ref={containerRef}
          style={{
            position: 'absolute',
            inset: 0,
            overflow: 'clip',
            // No padding: fullscreen TUIs measure cols against the full area
            padding: 0
          }}
        />
      </div>
    </div>
  )
}

export default CodingTerminalView

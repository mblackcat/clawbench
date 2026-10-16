import { useCallback, useEffect, useRef } from 'react'
import { Terminal, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { SearchAddon, type ISearchOptions } from '@xterm/addon-search'
import { ClipboardAddon } from '@xterm/addon-clipboard'
import '@xterm/xterm/css/xterm.css'
import { TERMINAL_FONT_STACK } from '../utils/mono-font'
import { TERMINAL_FONT_SIZE, TERMINAL_LINE_HEIGHT } from '../utils/terminal-theme'

/**
 * Highlight every match, not just the active one. The overview-ruler colours
 * are required by ISearchDecorationOptions even when the ruler is off.
 */
const SEARCH_OPTIONS: ISearchOptions = {
  decorations: {
    matchBackground: '#62331c',
    matchOverviewRuler: '#d18616',
    activeMatchBackground: '#9e6a03',
    activeMatchBorder: '#f9f1a5',
    activeMatchColorOverviewRuler: '#f9f1a5'
  }
}

/** Layout/PTY helpers handed to `onReady` so callers can drive spawn-time sizing. */
export interface XtermHelpers {
  /** Fit to the container; notify the PTY only when the measured size changed. */
  fit: () => void
  /** Fit and notify the PTY unconditionally (post-visibility, route re-entry). */
  forceFit: () => void
  /** Resolve once the container has a real box and xterm measured sane cols/rows. */
  waitForLayout: (maxFrames?: number) => Promise<void>
  /**
   * Register teardown that runs when the terminal is disposed. Call this
   * *synchronously*, before the first `await` in `onReady` — a cleanup handed
   * over after an await may not be registered before the component unmounts,
   * which would leave a subscription writing into a disposed terminal.
   */
  onDispose: (cleanup: () => void) => void
}

export type PasteOutcome = 'ok' | 'empty' | 'non-text' | 'failed'

/**
 * Read the clipboard and forward text via `onInput`. An empty readText() is
 * probed so hosts can tell an image/file payload ('non-text') from a truly
 * empty clipboard ('empty').
 */
async function pasteFromClipboard(onInput: (data: string) => void): Promise<PasteOutcome> {
  try {
    const text = await navigator.clipboard.readText()
    if (text) {
      onInput(text)
      return 'ok'
    }
    try {
      const items = await navigator.clipboard.read()
      if (items.some((item) => !item.types.some((tp) => tp === 'text/plain'))) return 'non-text'
    } catch { /* clipboard.read() unsupported or denied */ }
    return 'empty'
  } catch {
    return 'failed'
  }
}

export interface UseXtermOptions {
  /** Terminal identity. Changing it disposes and rebuilds the instance. */
  sessionKey: string
  theme: ITheme
  scrollback: number
  /** User keystrokes and pasted text, to be forwarded to the backing PTY. */
  onInput: (data: string) => void
  /** Measured grid size changed (or was force-published). */
  onResize: (cols: number, rows: number) => void
  /**
   * Runs once the terminal and its addons are live. May be async; register any
   * teardown through `helpers.onDispose`.
   */
  onReady?: (term: Terminal, helpers: XtermHelpers) => void | Promise<void>
  /** Fires on every completed selection, with the selected text. */
  onSelection?: (text: string) => void
  /** Match count / active index for a search bar. */
  onSearchResults?: (result: { resultIndex: number; resultCount: number }) => void
  /**
   * Outcome of a keyboard paste (Cmd/Ctrl+V) that delivered nothing
   * ('non-text' / 'failed'), so the host can tell the user why.
   */
  onPasteResult?: (outcome: PasteOutcome) => void
  /**
   * Re-publish the size on window resize / tab visibility / intersection.
   * Needed by hosts whose container is laid out lazily (Allotment panes,
   * route re-entry); plain always-visible hosts can leave it off.
   */
  watchVisibility?: boolean
}

export interface UseXtermResult {
  containerRef: React.RefObject<HTMLDivElement>
  termRef: React.MutableRefObject<Terminal | null>
  copy: () => void
  paste: () => Promise<PasteOutcome>
  selectAll: () => void
  clear: () => void
  focus: () => void
  findNext: (q: string) => void
  findPrevious: (q: string) => void
  clearSearch: () => void
}

/**
 * The single xterm.js engine used by AI Coding and AI Terminal.
 *
 * Both surfaces host the same class of workload — Ink-based CLI agents
 * (claude / codex / gemini / grok / omp) that repaint the full viewport on
 * every keystroke — so they need identical treatment:
 *
 * - **WebGL renderer.** The DOM renderer rebuilds a span per cell, which is
 *   what made typing into a TUI lag. WebGL rasterises glyphs into a texture
 *   atlas on the GPU instead. Context loss is recoverable: we dispose the
 *   addon and xterm falls back to the DOM renderer rather than going blank.
 * - **Unicode 11 widths.** xterm defaults to the Unicode 6 width table, which
 *   mis-measures CJK, emoji and the ambiguous-width ranges Nerd Font chrome
 *   lives in — the cause of drifting TUI borders.
 * - **Synchronized output (DEC 2026)**, new in xterm 6 and on by default:
 *   the TUI can mark a frame as in-progress so we never paint a half-drawn
 *   redraw.
 *
 * Everything below the addon setup is accumulated TUI/IME workarounds that
 * used to be duplicated in both components.
 */
export function useXterm(options: UseXtermOptions): UseXtermResult {
  const { sessionKey, theme, scrollback, watchVisibility } = options

  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const searchRef = useRef<SearchAddon | null>(null)

  // Callbacks live in refs so the terminal is never rebuilt just because a
  // parent re-rendered with fresh closures. The effect keys off sessionKey only.
  const cbRef = useRef(options)
  cbRef.current = options

  useEffect(() => {
    const containerEl = containerRef.current
    if (!containerEl) return

    const term = new Terminal({
      fontFamily: TERMINAL_FONT_STACK,
      fontSize: TERMINAL_FONT_SIZE,
      lineHeight: TERMINAL_LINE_HEIGHT,
      letterSpacing: 0,
      cursorBlink: true,
      cursorStyle: 'bar',
      theme,
      minimumContrastRatio: 4.5,
      scrollback,
      allowProposedApi: true,
      // Draw box-drawing / block characters ourselves rather than trusting the
      // font. TUI frames (omp panels, Claude's input box) then join up cleanly
      // even with a non-1.0 line height.
      customGlyphs: true,
      // Shrink glyphs that would otherwise bleed into the neighbouring cell —
      // mainly GB18030 / CJK coverage from fallback faces. Emoji, Powerline and
      // Nerd Font glyphs are exempt by design, so this is not what keeps omp's
      // status line aligned; that is the WebGL atlas. See mono-font.ts.
      rescaleOverlappingGlyphs: true,
      // TUIs like omp turn on mouse tracking (DECSET 1000/1002/1006), which
      // hands every press to the app and leaves drag-selection dead. xterm's
      // escape hatch is `shouldForceSelection`: shiftKey on Windows/Linux, but
      // on macOS it checks altKey AND this option — which defaults to false,
      // so on macOS there was no way to select at all. Turning it on gives
      // Option+drag there; hosts also expose a context menu as the
      // discoverable path on both platforms.
      macOptionClickForcesSelection: true,
      // Don't convert lone \n → \r\n; some ConPTY-hosted TUIs already emit
      // the correct sequence and would end up double-spaced.
      convertEol: false
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)

    // Load before open() so the very first writes are measured with the
    // correct wide-character widths.
    try {
      term.loadAddon(new Unicode11Addon())
      term.unicode.activeVersion = '11'
    } catch { /* proposed API unavailable — keep the v6 table */ }

    const searchAddon = new SearchAddon()
    term.loadAddon(searchAddon)
    searchRef.current = searchAddon
    searchAddon.onDidChangeResults((result) => cbRef.current.onSearchResults?.(result))

    // OSC 52 — lets a TUI (or a remote shell over SSH) put text on the host
    // clipboard, which is how copying out of tmux/nvim inside these agents works.
    try {
      term.loadAddon(new ClipboardAddon())
    } catch { /* non-fatal */ }

    term.loadAddon(new WebLinksAddon((_event, uri) => window.open(uri, '_blank')))

    term.open(containerEl)

    // WebGL must be attached after open() — it needs a canvas in the document.
    let webgl: WebglAddon | null = null
    try {
      webgl = new WebglAddon()
      webgl.onContextLoss(() => {
        // Chromium drops GL contexts on OOM or after system suspend. Disposing
        // the addon drops xterm back to the DOM renderer; without this the
        // terminal renders as a blank rectangle until remount.
        try { webgl?.dispose() } catch { /* already gone */ }
        webgl = null
      })
      term.loadAddon(webgl)
    } catch {
      // No WebGL2 (software rendering, blocklisted GPU) — DOM renderer stands in.
      webgl = null
    }

    termRef.current = term

    // ── IME: candidate popup anchoring ──────────────────────────────────────
    //
    // xterm's hidden helper textarea accumulates committed IME text across
    // successive compositions. The OS IME anchors its candidate popup at the
    // textarea's caret — after a commit that caret sits at the end of the
    // accumulated text, so the next Chinese composition's popup floats to
    // wherever the text ends instead of the cursor cell.
    //
    // Clear the value at compositionstart in the CAPTURE phase so it runs
    // BEFORE xterm's bubble-phase listener (which records
    // `compositionPosition.start = textarea.value.length`). xterm then sees
    // start=0, pulls the full composition via value.substring(0, end), and the
    // caret stays at offset 0 — so the popup anchors at the textarea origin.
    const helperTextarea = containerEl.querySelector('.xterm-helper-textarea') as HTMLTextAreaElement | null
    const handleCompositionStart = (): void => {
      if (helperTextarea && helperTextarea.value !== '') helperTextarea.value = ''
    }
    helperTextarea?.addEventListener('compositionstart', handleCompositionStart, true)

    // Lock the textarea position once we've seen a correct anchor.
    //
    // TUIs like Claude Code redraw a status line at the bottom of the viewport
    // on every input, which leaves xterm's tracked cursor (`buffer.x/y`) at the
    // bottom-right even though the *visible* cursor stays in the input box
    // (Claude paints a reverse-video block and parks the real cursor
    // elsewhere). `CompositionHelper.updateCompositionElements` reads
    // `buffer.x/y` to place the textarea, so the popup follows the redrawn
    // cursor instead of the visible one.
    //
    // We can't know where the TUI visually renders its cursor — so remember the
    // position from the first composition (anchored to the user's actual typing
    // spot) and snap later ones back to it.
    let lockedLeft: string | null = null
    let lockedTop: string | null = null
    let suppressMutation = false
    const styleObserver = helperTextarea
      ? new MutationObserver(() => {
          if (suppressMutation || lockedLeft === null) return
          if (helperTextarea.style.left !== lockedLeft || helperTextarea.style.top !== lockedTop) {
            suppressMutation = true
            helperTextarea.style.left = lockedLeft
            helperTextarea.style.top = lockedTop!
            suppressMutation = false
          }
        })
      : null
    if (helperTextarea) {
      styleObserver?.observe(helperTextarea, { attributes: true, attributeFilter: ['style'] })
    }
    const handleCompositionUpdate = (): void => {
      if (lockedLeft === null && helperTextarea && helperTextarea.style.left) {
        lockedLeft = helperTextarea.style.left
        lockedTop = helperTextarea.style.top
      }
    }
    helperTextarea?.addEventListener('compositionupdate', handleCompositionUpdate)

    // A click means the user may want to type somewhere new — release the lock
    // so the next composition re-captures.
    const handleClickReset = (): void => {
      lockedLeft = null
      lockedTop = null
    }
    containerEl.addEventListener('mousedown', handleClickReset)

    // ── IME: stray horizontal scroll ────────────────────────────────────────
    //
    // During composition xterm grows the helper textarea to fit the pending
    // text. Once it overflows the viewport the browser calls scrollIntoView on
    // the focused textarea and sets scrollLeft on every scrollable ancestor —
    // `overflow: hidden` does NOT block that, and the whole TUI slides
    // sideways. Catch it on the capture phase and snap back to 0.
    const xtermRoot = containerEl.querySelector('.xterm') as HTMLElement | null
    const scrollTargets: HTMLElement[] = [containerEl]
    const wrapperEl = containerEl.parentElement
    if (wrapperEl) scrollTargets.push(wrapperEl)
    if (wrapperEl?.parentElement) scrollTargets.push(wrapperEl.parentElement)
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

    // ── Sizing ──────────────────────────────────────────────────────────────
    let lastCols = 0
    let lastRows = 0

    const fit = (): void => {
      try {
        fitAddon.fit()
        if (term.cols > 0 && term.rows > 0 && (term.cols !== lastCols || term.rows !== lastRows)) {
          lastCols = term.cols
          lastRows = term.rows
          cbRef.current.onResize(term.cols, term.rows)
        }
      } catch {
        // FitAddon throws while the container is not measurable.
      }
    }

    const forceFit = (): void => {
      try {
        fitAddon.fit()
        if (term.cols > 0 && term.rows > 0) {
          lastCols = term.cols
          lastRows = term.rows
          cbRef.current.onResize(term.cols, term.rows)
        }
      } catch {
        // ignore until measurable
      }
    }

    const waitForLayout = async (maxFrames = 30): Promise<void> => {
      for (let i = 0; i < maxFrames; i++) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
        const el = containerRef.current
        if (el && el.clientWidth > 40 && el.clientHeight > 40) {
          // Require a real measurement: until the renderer has font metrics
          // proposeDimensions() is undefined and the terminal is still at its
          // 80x24 default — checking term.cols alone let that default through,
          // so TUIs were spawned 80 columns wide and left a blank right side.
          const dims = fitAddon.proposeDimensions()
          if (dims && dims.cols >= 20 && dims.rows >= 5) {
            fit()
            return
          }
        }
      }
      fit()
    }

    // Re-measure once the font actually resolves. xterm only re-runs its cell
    // measurement when the fontFamily/fontSize *option* changes, not when the
    // browser finishes loading a face — so a late-resolving Nerd Font leaves a
    // cached cell width that no longer matches the painted glyphs, throwing off
    // click-to-column math for drag-selection.
    document.fonts.ready.then(() => {
      if (termRef.current !== term) return
      try {
        forceFit()
        term.refresh(0, term.rows - 1)
      } catch { /* ignore */ }
    })

    // ── Input ───────────────────────────────────────────────────────────────
    const isMac = window.api.platform === 'darwin'
    term.attachCustomKeyEventHandler((event) => {
      // Let the IME own the keystroke while composing, otherwise the committed
      // text arrives twice.
      if (event.type === 'keydown' && (event.isComposing || event.keyCode === 229)) {
        return false
      }
      if (event.type === 'keydown' && (event.key === 'v' || event.key === 'V')) {
        const matchesPaste = isMac
          ? event.metaKey && !event.ctrlKey && !event.altKey
          : event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey
        if (matchesPaste) {
          // preventDefault so the browser does not also fire its native `paste`
          // event on xterm's hidden textarea — that would write it twice.
          event.preventDefault()
          void pasteFromClipboard((text) => cbRef.current.onInput(text)).then((outcome) => {
            if (outcome === 'non-text' || outcome === 'failed') cbRef.current.onPasteResult?.(outcome)
          })
          return false
        }
      }
      if (event.type === 'keydown' && (event.key === 'c' || event.key === 'C')) {
        const matchesCopy = isMac
          ? event.metaKey && !event.ctrlKey && !event.altKey
          : event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey
        // On Windows/Linux Ctrl+C is also SIGINT, so only claim it when there
        // is a selection — otherwise it must still reach the TUI to interrupt.
        if (matchesCopy && term.hasSelection()) {
          event.preventDefault()
          navigator.clipboard.writeText(term.getSelection()).catch(() => { /* denied */ })
          return false
        }
      }
      return true
    })

    term.onData((data) => cbRef.current.onInput(data))

    // A completed selection lands on the clipboard right away, so "select here,
    // paste there" works without a second step.
    term.onSelectionChange(() => {
      const selection = term.getSelection()
      if (!selection) return
      navigator.clipboard.writeText(selection).catch(() => { /* denied */ })
      cbRef.current.onSelection?.(selection)
    })

    // ── Host wiring ─────────────────────────────────────────────────────────
    let disposed = false
    const hostCleanups: (() => void)[] = []
    const onDispose = (cleanup: () => void): void => {
      // Registering after teardown means we already missed the window — run it
      // right away rather than leaking the subscription.
      if (disposed) cleanup()
      else hostCleanups.push(cleanup)
    }
    Promise.resolve(cbRef.current.onReady?.(term, { fit, forceFit, waitForLayout, onDispose }))
      .catch(() => { /* host reports its own failures into the terminal */ })

    const resizeObserver = new ResizeObserver(() => fit())
    resizeObserver.observe(containerEl)

    const onWindowResize = (): void => forceFit()
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') forceFit()
    }
    let intersectionObserver: IntersectionObserver | null = null
    if (watchVisibility) {
      window.addEventListener('resize', onWindowResize)
      document.addEventListener('visibilitychange', onVisibility)
      if (typeof IntersectionObserver !== 'undefined') {
        intersectionObserver = new IntersectionObserver((entries) => {
          if (entries.some((e) => e.isIntersecting && e.intersectionRatio > 0)) forceFit()
        }, { threshold: [0, 0.01, 1] })
        intersectionObserver.observe(containerEl)
      }
    }

    return () => {
      disposed = true
      for (const cleanup of hostCleanups) {
        try { cleanup() } catch { /* keep tearing the rest down */ }
      }
      resizeObserver.disconnect()
      intersectionObserver?.disconnect()
      if (watchVisibility) {
        window.removeEventListener('resize', onWindowResize)
        document.removeEventListener('visibilitychange', onVisibility)
      }
      helperTextarea?.removeEventListener('compositionstart', handleCompositionStart, true)
      helperTextarea?.removeEventListener('compositionupdate', handleCompositionUpdate)
      styleObserver?.disconnect()
      containerEl.removeEventListener('mousedown', handleClickReset)
      for (const el of scrollTargets) {
        el.removeEventListener('scroll', resetScroll, { capture: true })
      }
      // Dispose the GL context explicitly; leaking these hits Chromium's
      // per-renderer context cap after a dozen tab switches.
      try { webgl?.dispose() } catch { /* already gone */ }
      term.dispose()
      termRef.current = null
      searchRef.current = null
    }
    // theme/scrollback/watchVisibility are per-host constants, not reactive
    // inputs — rebuilding the terminal is only ever driven by sessionKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey])

  // Dynamically update terminal palette when the host switches themes
  useEffect(() => {
    if (termRef.current && theme) {
      termRef.current.options.theme = theme
      termRef.current.options.minimumContrastRatio = 4.5
    }
  }, [theme])

  const copy = useCallback(() => {
    const selection = termRef.current?.getSelection()
    if (selection) navigator.clipboard.writeText(selection).catch(() => { /* denied */ })
  }, [])

  const paste = useCallback(
    (): Promise<PasteOutcome> => pasteFromClipboard((text) => cbRef.current.onInput(text)),
    []
  )

  const selectAll = useCallback(() => termRef.current?.selectAll(), [])
  const clear = useCallback(() => termRef.current?.clear(), [])
  const focus = useCallback(() => termRef.current?.focus(), [])

  const findNext = useCallback((q: string) => {
    if (q) searchRef.current?.findNext(q, SEARCH_OPTIONS)
    else searchRef.current?.clearDecorations()
  }, [])
  const findPrevious = useCallback((q: string) => {
    if (q) searchRef.current?.findPrevious(q, SEARCH_OPTIONS)
  }, [])
  const clearSearch = useCallback(() => searchRef.current?.clearDecorations(), [])

  return { containerRef, termRef, copy, paste, selectAll, clear, focus, findNext, findPrevious, clearSearch }
}

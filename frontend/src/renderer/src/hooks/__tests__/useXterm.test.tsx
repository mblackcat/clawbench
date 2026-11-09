import React, { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Terminal } from '@xterm/xterm'
import { useXterm, pasteIntoTerm, type UseXtermResult, type XtermHelpers } from '../useXterm'

interface TestHarnessProps {
  sessionKey: string
  onSelection?: (text: string) => void
  onCopy?: (text: string) => void
  onExpose?: (hook: UseXtermResult) => void
  onInput?: (data: string) => void
  onReady?: (term: Terminal, helpers: XtermHelpers) => void | Promise<void>
}

const TestTerminalHarness: React.FC<TestHarnessProps> = ({ sessionKey, onSelection, onCopy, onExpose, onInput, onReady }) => {
  const result = useXterm({
    sessionKey,
    theme: {},
    scrollback: 1000,
    onInput: onInput ?? (() => {}),
    onResize: () => {},
    onReady,
    onSelection,
    onCopy,
  })

  useEffect(() => {
    onExpose?.(result)
  }, [result, onExpose])

  return <div ref={result.containerRef} />
}

describe('useXterm clipboard behavior', () => {
  let root: Root | null = null
  let container: HTMLDivElement | null = null

  beforeEach(() => {
    vi.clearAllMocks()

    window.api = {
      platform: 'win32'
    } as any

    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({
        matches: false,
        media: '',
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn()
      }))
    })

    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { ready: Promise.resolve() }
    })

    globalThis.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as any

    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
        readText: vi.fn().mockResolvedValue(''),
        read: vi.fn().mockResolvedValue([])
      }
    })

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    if (root) {
      act(() => {
        root!.unmount()
      })
      root = null
    }
    if (container && container.parentNode) {
      container.parentNode.removeChild(container)
      container = null
    }
  })

  it('does NOT write to clipboard on selection change', async () => {
    const onSelection = vi.fn()
    let exposedHook: UseXtermResult | null = null

    await act(async () => {
      root!.render(
        <TestTerminalHarness
          sessionKey="session-sel"
          onSelection={onSelection}
          onExpose={(h) => { exposedHook = h }}
        />
      )
    })

    expect(exposedHook).toBeDefined()
    const term = exposedHook!.termRef.current
    expect(term).toBeDefined()

    vi.spyOn(term!, 'getSelection').mockReturnValue('highlighted command or text')

    await act(async () => {
      ;(term as any)._core?._onSelectionChange?.fire?.()
    })

    // Callback receives the selected text
    expect(onSelection).toHaveBeenCalledWith('highlighted command or text')

    // System clipboard MUST NOT have been written to on selection change
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled()
  })

  it('writes to clipboard on explicit copy() call and triggers onCopy', async () => {
    const onCopy = vi.fn()
    let exposedHook: UseXtermResult | null = null

    await act(async () => {
      root!.render(
        <TestTerminalHarness
          sessionKey="session-copy"
          onCopy={onCopy}
          onExpose={(h) => { exposedHook = h }}
        />
      )
    })

    expect(exposedHook).toBeDefined()
    const term = exposedHook!.termRef.current
    expect(term).toBeDefined()

    vi.spyOn(term!, 'getSelection').mockReturnValue('copied text snippet')

    await act(async () => {
      exposedHook!.copy()
    })

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('copied text snippet')
    expect(onCopy).toHaveBeenCalledWith('copied text snippet')
  })

  it('pasteIntoTerm delegates single-line text directly to term.paste', () => {
    const mockTerm = {
      modes: { bracketedPasteMode: false },
      paste: vi.fn(),
      input: vi.fn()
    } as any

    pasteIntoTerm(mockTerm, 'single line command')
    expect(mockTerm.paste).toHaveBeenCalledWith('single line command')
    expect(mockTerm.input).not.toHaveBeenCalled()
  })

  it('pasteIntoTerm wraps multi-line text in bracketed paste when bracketedPasteMode is not yet active', () => {
    const mockTerm = {
      modes: { bracketedPasteMode: false },
      paste: vi.fn(),
      input: vi.fn()
    } as any

    pasteIntoTerm(mockTerm, 'line 1\r\nline 2\nline 3')
    expect(mockTerm.input).toHaveBeenCalledWith('\x1b[200~line 1\rline 2\rline 3\x1b[201~', true)
    expect(mockTerm.paste).not.toHaveBeenCalled()
  })

  it('pasteIntoTerm uses term.paste when bracketedPasteMode is already active', () => {
    const mockTerm = {
      modes: { bracketedPasteMode: true },
      paste: vi.fn(),
      input: vi.fn()
    } as any

    pasteIntoTerm(mockTerm, 'line 1\nline 2')
    expect(mockTerm.paste).toHaveBeenCalledWith('line 1\nline 2')
    expect(mockTerm.input).not.toHaveBeenCalled()
  })

  it('paste() hook method reads from clipboard and handles multiline text safely', async () => {
    let exposedHook: UseXtermResult | null = null

    await act(async () => {
      root!.render(
        <TestTerminalHarness
          sessionKey="session-paste"
          onExpose={(h) => { exposedHook = h }}
        />
      )
    })

    const term = exposedHook!.termRef.current!
    const inputSpy = vi.spyOn(term, 'input').mockImplementation(() => {})
    const pasteSpy = vi.spyOn(term, 'paste').mockImplementation(() => {})

    vi.mocked(navigator.clipboard.readText).mockResolvedValueOnce('echo first\necho second')

    let outcome: string | undefined
    await act(async () => {
      outcome = await exposedHook!.paste()
    })

    expect(outcome).toBe('ok')
    expect(inputSpy).toHaveBeenCalledWith('\x1b[200~echo first\recho second\x1b[201~', true)
    expect(pasteSpy).not.toHaveBeenCalled()
  })
})

/** OSC 52 "set clipboard" as Claude Code / omp / grok emit it (BEL-terminated). */
const osc52Set = (text: string): string =>
  `\x1b]52;c;${Buffer.from(text, 'utf8').toString('base64')}\x07`

/** Resolve once xterm has parsed everything queued so far. */
const flushWrites = (term: Terminal): Promise<void> =>
  new Promise<void>((resolve) => term.write('', resolve))

describe('useXterm OSC 52 guard', () => {
  let root: Root | null = null
  let container: HTMLDivElement | null = null

  beforeEach(() => {
    vi.clearAllMocks()
    window.api = { platform: 'win32' } as any
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({
        matches: false,
        media: '',
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn()
      }))
    })
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { ready: Promise.resolve() }
    })
    globalThis.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as any
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
        readText: vi.fn().mockResolvedValue('user clipboard'),
        read: vi.fn().mockResolvedValue([])
      }
    })
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (root) {
      act(() => { root!.unmount() })
      root = null
    }
    if (container?.parentNode) {
      container.parentNode.removeChild(container)
      container = null
    }
  })

  /**
   * Mount a terminal whose host replays `history` the way CodingTerminalView /
   * TerminalPanel do: queue the writes, then call setReplayDone() right away
   * (synchronously, before xterm has parsed anything).
   */
  const mountWithReplay = async (
    history: string,
    onInput: (data: string) => void = () => {}
  ): Promise<Terminal> => {
    let exposed: UseXtermResult | null = null
    let replayQueued!: () => void
    const replayQueuedPromise = new Promise<void>((r) => { replayQueued = r })
    await act(async () => {
      root!.render(
        <TestTerminalHarness
          sessionKey="session-osc52"
          onInput={onInput}
          onExpose={(h) => { exposed = h }}
          onReady={(term, h) => {
            // Focus first: switching sessions is a click, so the terminal (or
            // at least the window) is focused while the replay is parsed.
            term.focus()
            term.write(history)
            h.setReplayDone?.()
            replayQueued()
          }}
        />
      )
    })
    await replayQueuedPromise
    const term = exposed!.termRef.current!
    await act(async () => { await flushWrites(term) })
    return term
  }

  it('does not re-run OSC 52 copies from replayed history on session switch', async () => {
    await mountWithReplay(`previous output\r\n${osc52Set('stale copy from history')}more output\r\n`)
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled()
  })

  it('does not answer OSC 52 clipboard queries found in replayed history', async () => {
    const onInput = vi.fn()
    // agy probes the clipboard with ESC]52;c;? — replaying it must not inject
    // a clipboard report into the live PTY.
    await mountWithReplay('\x1b]52;c;?\x07', onInput)
    // Let any async readText → report round-trip settle.
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    expect(navigator.clipboard.readText).not.toHaveBeenCalled()
    expect(onInput).not.toHaveBeenCalled()
  })

  it('applies a live OSC 52 copy from the focused terminal after replay', async () => {
    const term = await mountWithReplay('history\r\n')
    term.focus()
    await act(async () => {
      term.write(osc52Set('fresh copy'))
      await flushWrites(term)
    })
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('fresh copy')
  })

  it('ignores a live OSC 52 copy when the terminal is not focused', async () => {
    const term = await mountWithReplay('history\r\n')
    term.blur()
    const other = document.createElement('input')
    document.body.appendChild(other)
    other.focus()
    await act(async () => {
      term.write(osc52Set('background pane copy'))
      await flushWrites(term)
    })
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled()
    other.remove()
  })

  it('ignores a live OSC 52 copy when the window is not focused', async () => {
    const term = await mountWithReplay('history\r\n')
    term.focus()
    vi.mocked(document.hasFocus).mockReturnValue(false)
    await act(async () => {
      term.write(osc52Set('copy while app in background'))
      await flushWrites(term)
    })
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled()
  })

  it('never clears the clipboard on a malformed OSC 52 payload', async () => {
    const term = await mountWithReplay('history\r\n')
    term.focus()
    await act(async () => {
      term.write('\x1b]52;c;not*base64\x07')
      await flushWrites(term)
    })
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled()
  })
})

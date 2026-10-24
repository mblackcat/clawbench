/**
 * Monospace font stack used for code blocks, inline code, SQL editors, and
 * xterm terminals.
 *
 * Latin: Consolas (Windows) → Monaco (macOS) → Menlo → Courier New.
 * CJK fallbacks mirror the app UI face (App.tsx FONT_FAMILY) so Chinese in
 * terminals and code surfaces matches the rest of the product instead of the
 * system default "monospace" CJK (often Song / Ming that feels out of place).
 *
 * Glyph matching is per-character: Latin stays mono; 中文 falls through to
 * YaHei / PingFang once the mono faces lack those glyphs.
 *
 * Keep CSS copies (chat-styles.css, theme-overhaul.css) in sync with this.
 */
export const MONO_FONT_STACK =
  "'Consolas', 'Monaco', 'Menlo', 'Courier New', 'Microsoft YaHei UI', 'Microsoft YaHei', 'PingFang SC', 'Hiragino Sans GB', 'Noto Sans SC', 'Source Han Sans SC', sans-serif"

/**
 * Font stack for xterm-hosted TUIs (AI Coding terminal view, AI Terminal).
 *
 * Same as MONO_FONT_STACK but led by the bundled Nerd Font symbol face
 * (styles/terminal-font.css). Modern CLI agents paint their chrome with Nerd
 * Font private-use glyphs (powerline separators, model / folder / context
 * icons); system mono faces lack them, so without this they render as tofu
 * and status-line borders drift. Leading with the symbol font is safe because
 * it is symbols-only: ordinary Latin/CJK text falls through per character.
 */
const IS_MAC = typeof window !== 'undefined' && window.api?.platform === 'darwin'

/** Bundled JetBrainsMono Nerd Font Mono (styles/terminal-font.css), macOS only. */
export const TERMINAL_MAC_FACE = 'ClawBench Terminal Mono'

/**
 * On macOS the stack is led by the bundled JetBrainsMono Nerd Font Mono, which
 * carries the Nerd glyphs itself; the symbols face stays as a fallback. Windows
 * keeps the Consolas-based stack unchanged.
 */
export const TERMINAL_FONT_STACK = IS_MAC
  ? `'${TERMINAL_MAC_FACE}', 'Symbols Nerd Font Mono', ${MONO_FONT_STACK}`
  : `'Symbols Nerd Font Mono', ${MONO_FONT_STACK}`

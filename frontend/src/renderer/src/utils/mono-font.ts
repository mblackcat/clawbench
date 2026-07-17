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

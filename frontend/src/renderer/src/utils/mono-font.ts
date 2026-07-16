/**
 * Monospace font stack used for code blocks, inline code, SQL editors, and
 * xterm terminals. Consolas is the primary face on Windows; Monaco on macOS.
 * The browser picks the first installed family, so listing both (followed by
 * Menlo and a generic monospace fallback) gives the right native feel on each
 * platform without runtime platform detection.
 *
 * Keep xterm fontFamily in sync with this constant so terminals match the
 * rest of the app's code surfaces.
 */
export const MONO_FONT_STACK =
  "'Consolas', 'Monaco', 'Menlo', 'Courier New', monospace"

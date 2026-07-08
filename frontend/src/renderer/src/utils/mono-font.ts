/**
 * Monospace font stack used for code blocks and inline code across the AI
 * Coding chat. Consolas is the primary face on Windows; Monaco on macOS.
 * The browser picks the first installed family, so listing both (followed by
 * Menlo and a generic monospace fallback) gives the right native feel on each
 * platform without runtime platform detection.
 */
export const MONO_FONT_STACK =
  "'Consolas', 'Monaco', 'Menlo', 'Courier New', monospace"

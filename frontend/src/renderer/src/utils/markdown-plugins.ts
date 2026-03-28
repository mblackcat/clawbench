/**
 * Shared rehype-highlight configuration using lowlight/common subset.
 *
 * By default rehype-highlight registers ALL highlight.js languages (~180+).
 * Using lowlight/common limits this to ~37 common languages, significantly
 * reducing the renderer bundle size while covering virtually all use cases.
 */
import rehypeHighlight from 'rehype-highlight'
import { common, createLowlight } from 'lowlight'

const lowlight = createLowlight(common)

export const rehypeHighlightOptions = { lowlight }

/**
 * Pre-configured rehype plugin for use in ReactMarkdown's rehypePlugins array.
 * Usage: rehypePlugins={[rehypeHighlightPlugin]}
 */
export const rehypeHighlightPlugin: [typeof rehypeHighlight, typeof rehypeHighlightOptions] = [
  rehypeHighlight,
  rehypeHighlightOptions
]

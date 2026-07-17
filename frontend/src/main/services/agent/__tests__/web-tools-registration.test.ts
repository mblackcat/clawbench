import { describe, it, expect } from 'vitest'
import { resolveAgentTools } from '../agent-tools'
import { WEB_SEARCH_TOOL, WEB_FETCH_TOOL } from '../../web-search.service'

/**
 * Structural registration check: Claude Code–style web tools are live;
 * plan_search must not appear in the agent catalog.
 */
describe('resolveAgentTools web catalog (shipped)', () => {
  it('registers web_search + web_browse when webSearchEnabled, not plan_search', async () => {
    const tools = await resolveAgentTools({
      toolsEnabled: true,
      webSearchEnabled: true,
      includeInternal: false,
      includeMcp: false,
      feishuKitsEnabled: false,
    })
    const names = tools.map((t) => t.name)
    expect(names).toContain('web_search')
    expect(names).toContain('web_browse')
    expect(names).not.toContain('plan_search')

    const search = tools.find((t) => t.name === 'web_search')!
    expect(search.description).toContain('Sources')
    expect(search.description.length).toBeGreaterThan(80)
    // Matches exported tool definition used by agent catalog
    expect(search.description).toBe(WEB_SEARCH_TOOL.description)
    expect(search.inputSchema).toEqual(WEB_SEARCH_TOOL.inputSchema)

    const fetch = tools.find((t) => t.name === 'web_browse')!
    expect(fetch.description).toContain('URL')
    expect(fetch.inputSchema.properties).toHaveProperty('prompt')
    expect(fetch.description).toBe(WEB_FETCH_TOOL.description)
  })

  it('omits web tools when webSearchEnabled is false', async () => {
    const tools = await resolveAgentTools({
      toolsEnabled: true,
      webSearchEnabled: false,
      includeInternal: false,
      includeMcp: false,
    })
    const names = tools.map((t) => t.name)
    expect(names).not.toContain('web_search')
    expect(names).not.toContain('web_browse')
  })
})

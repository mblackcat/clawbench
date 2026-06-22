import { describe, expect, it } from 'vitest'
import { getShortcutApps } from '../shortcut-selection'
import type { SubAppInfo } from '../subapp.service'

function app(id: string, type?: SubAppInfo['manifest']['type']): SubAppInfo {
  return {
    id,
    path: `/apps/${id}`,
    source: 'user',
    manifest: {
      id,
      name: id,
      version: '1.0.0',
      description: '',
      entry: type === 'prompt' ? 'prompt.md' : type === 'ai-skill' ? 'SKILL.md' : 'main.py',
      type,
    },
  }
}

describe('getShortcutApps', () => {
  it('only includes runnable app resources', () => {
    const shortcutApps = getShortcutApps([
      app('first-prompt', 'prompt'),
      app('first-app', 'app'),
      app('legacy-app'),
      app('first-skill', 'ai-skill'),
    ], [])

    expect(shortcutApps.map((item) => item.id)).toEqual(['first-app', 'legacy-app'])
  })

  it('keeps shortcut numbering aligned with the app group order', () => {
    const shortcutApps = getShortcutApps([
      app('app-1', 'app'),
      app('prompt-1', 'prompt'),
      app('app-2', 'app'),
    ], ['prompt-1', 'app-2', 'app-1'])

    expect(shortcutApps.map((item) => item.id)).toEqual(['app-2', 'app-1'])
  })
})

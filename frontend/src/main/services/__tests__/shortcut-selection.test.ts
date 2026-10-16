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

  it('puts pinned apps first, keeping appOrder within each section', () => {
    const shortcutApps = getShortcutApps(
      [app('app-1', 'app'), app('app-2', 'app'), app('app-3', 'app')],
      ['app-1', 'app-2', 'app-3'],
      ['app-3', 'app-2']
    )

    expect(shortcutApps.map((item) => item.id)).toEqual(['app-2', 'app-3', 'app-1'])
  })

  it('applies pinning even when appOrder is empty', () => {
    const shortcutApps = getShortcutApps(
      [app('app-1', 'app'), app('app-2', 'app')],
      [],
      ['app-2']
    )

    expect(shortcutApps.map((item) => item.id)).toEqual(['app-2', 'app-1'])
  })

  it('hides project-disabled builtin apps when an allow-list is provided', () => {
    const enabled = app('com.clawbench.builtin.launch-client', 'app')
    const disabled = app('com.clawbench.builtin.env-check', 'app')
    const market = app('market-app', 'app')
    const shortcutApps = getShortcutApps(
      [disabled, enabled, market],
      [disabled.id, enabled.id, market.id],
      [],
      new Set(['launch-client'])
    )

    expect(shortcutApps.map((item) => item.id)).toEqual([
      'com.clawbench.builtin.launch-client',
      'market-app'
    ])
  })

  it('does not filter builtins when allow-list is null (offline / no project)', () => {
    const builtin = app('com.clawbench.builtin.env-check', 'app')
    const shortcutApps = getShortcutApps([builtin, app('market-app', 'app')], [], [], null)
    expect(shortcutApps.map((item) => item.id)).toEqual([
      'com.clawbench.builtin.env-check',
      'market-app'
    ])
  })
})

import { describe, expect, it } from 'vitest'
import { DEFAULT_MODULE_VISIBILITY, SETTINGS_MODULE_CARDS } from '../../../constants/module-visibility'

describe('settings module registry', () => {
  it('exposes CoPiper in module settings but keeps it disabled by default', () => {
    expect(SETTINGS_MODULE_CARDS.map((module) => module.key)).toContain('copiper')
    expect(DEFAULT_MODULE_VISIBILITY.copiper).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { SUBAPP_SDK_REFERENCE } from '../subappCreateSkill'

describe('sub-app generation skill dynamic option contract', () => {
  it('documents refreshable enum slots and session cache behavior', () => {
    expect(SUBAPP_SDK_REFERENCE).toContain('"options_slot": "models"')
    expect(SUBAPP_SDK_REFERENCE).toContain('def resolve_slot(self, slot: str)')
    expect(SUBAPP_SDK_REFERENCE).toContain('"type": "slot_result"')
    expect(SUBAPP_SDK_REFERENCE).toContain('session-only cache')
    expect(SUBAPP_SDK_REFERENCE).toContain('must not rewrite manifest.json')
  })
})

import { describe, expect, it } from 'vitest'
import { DARK_WINDOW_BG, LIGHT_WINDOW_BG, resolveWindowBackground } from '../window-background'

describe('resolveWindowBackground', () => {
  it('follows the OS for system', () => {
    expect(resolveWindowBackground('system', true)).toBe(DARK_WINDOW_BG)
    expect(resolveWindowBackground('system', false)).toBe(LIGHT_WINDOW_BG)
  })
  it('dark and dark-* palettes are dark regardless of OS', () => {
    expect(resolveWindowBackground('dark', false)).toBe(DARK_WINDOW_BG)
    expect(resolveWindowBackground('dark-ember', false)).toBe(DARK_WINDOW_BG)
  })
  it('everything else is light', () => {
    expect(resolveWindowBackground('light', true)).toBe(LIGHT_WINDOW_BG)
    expect(resolveWindowBackground('light-meadow', true)).toBe(LIGHT_WINDOW_BG)
    expect(resolveWindowBackground('', true)).toBe(LIGHT_WINDOW_BG)
  })
})

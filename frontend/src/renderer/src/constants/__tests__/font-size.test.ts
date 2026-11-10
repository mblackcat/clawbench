import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FONT_SIZE_CHANGE_EVENT,
  FONT_SIZE_STORAGE_KEY,
  applyFontSizeToDom,
  isLargeFontSize,
  normalizeFontSize,
  readStoredFontSize
} from '../font-size'

describe('font size mode', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-font-size')
    document.body.removeAttribute('data-font-size')
    for (const v of ['--cb-font-scale', '--cb-font-size-base', '--cb-font-size-sm']) {
      document.documentElement.style.removeProperty(v)
    }
  })

  afterEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('normalizes unknown values to standard', () => {
    expect(normalizeFontSize('large')).toBe('large')
    expect(normalizeFontSize('standard')).toBe('standard')
    expect(normalizeFontSize('huge')).toBe('standard')
    expect(normalizeFontSize('')).toBe('standard')
    expect(normalizeFontSize(undefined)).toBe('standard')
    expect(normalizeFontSize(null)).toBe('standard')
    expect(normalizeFontSize(1.2)).toBe('standard')
  })

  it('reads the localStorage mirror (default standard)', () => {
    expect(readStoredFontSize()).toBe('standard')
    localStorage.setItem(FONT_SIZE_STORAGE_KEY, 'large')
    expect(readStoredFontSize()).toBe('large')
    localStorage.setItem(FONT_SIZE_STORAGE_KEY, 'huge')
    expect(readStoredFontSize()).toBe('standard')
  })

  it('applies large mode to DOM, CSS variables and storage, and notifies', () => {
    const onEvent = vi.fn()
    window.addEventListener(FONT_SIZE_CHANGE_EVENT, onEvent)

    expect(applyFontSizeToDom('large')).toBe('large')
    expect(isLargeFontSize()).toBe(true)
    expect(localStorage.getItem(FONT_SIZE_STORAGE_KEY)).toBe('large')
    expect(document.documentElement.getAttribute('data-font-size')).toBe('large')
    expect(document.body.getAttribute('data-font-size')).toBe('large')
    expect(document.documentElement.style.getPropertyValue('--cb-font-scale')).toBe('1.2')
    expect(document.documentElement.style.getPropertyValue('--cb-font-size-base')).toBe('16.8px')
    expect(document.documentElement.style.getPropertyValue('--cb-font-size-sm')).toBe('14.4px')
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ detail: 'large' }))

    window.removeEventListener(FONT_SIZE_CHANGE_EVENT, onEvent)
  })

  it('switches back to standard; garbage input falls back to standard', () => {
    applyFontSizeToDom('large')
    expect(applyFontSizeToDom('standard')).toBe('standard')
    expect(isLargeFontSize()).toBe(false)
    expect(document.documentElement.style.getPropertyValue('--cb-font-scale')).toBe('1')
    expect(document.documentElement.style.getPropertyValue('--cb-font-size-base')).toBe('14px')

    applyFontSizeToDom('large')
    expect(applyFontSizeToDom('x-large')).toBe('standard')
    expect(localStorage.getItem(FONT_SIZE_STORAGE_KEY)).toBe('standard')
  })
})

import { describe, expect, it } from 'vitest'
import { getMarketAppIcon, resolveAppIconUrl } from '../AppIcon'

describe('resolveAppIconUrl', () => {
  it('resolves server-relative paths against the API origin', () => {
    expect(resolveAppIconUrl('/uploads/a.png', 'https://api.example.com/api/v1')).toBe(
      'https://api.example.com/uploads/a.png'
    )
  })

  it('keeps absolute, data and protocol-relative values as is', () => {
    expect(resolveAppIconUrl('https://x/y.png', 'http://h/api')).toBe('https://x/y.png')
    expect(resolveAppIconUrl('data:image/png;base64,AA', 'http://h/api')).toBe('data:image/png;base64,AA')
    expect(resolveAppIconUrl('//cdn/x.png', 'http://h/api')).toBe('//cdn/x.png')
  })

  it('returns null for empty input', () => {
    expect(resolveAppIconUrl('')).toBeNull()
    expect(resolveAppIconUrl('   ')).toBeNull()
    expect(resolveAppIconUrl(null)).toBeNull()
  })
})

describe('getMarketAppIcon', () => {
  it('prefers metadata.icon, then coverUrl', () => {
    expect(getMarketAppIcon({ metadata: { icon: 'i', coverUrl: 'c' } })).toBe('i')
    expect(getMarketAppIcon({ metadata: { coverUrl: 'c' } })).toBe('c')
    expect(getMarketAppIcon({ metadata: {} })).toBeUndefined()
    expect(getMarketAppIcon(undefined)).toBeUndefined()
  })
})

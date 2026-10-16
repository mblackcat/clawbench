import {
  compareVersions,
  resolveDiscoverStatus,
  resolveLocalAppStatus,
  shouldShowVersionDiff
} from '../app-status'

describe('app-status', () => {
  describe('compareVersions', () => {
    it('orders dotted versions', () => {
      expect(compareVersions('1.0.0', '1.0.1')).toBe(-1)
      expect(compareVersions('1.2.0', '1.1.9')).toBe(1)
      expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
    })
  })

  describe('resolveLocalAppStatus', () => {
    it('own draft / published / pending', () => {
      expect(
        resolveLocalAppStatus({ origin: 'own', isPublished: false, localVersion: '1.0.0' })
      ).toBe('draft')
      expect(
        resolveLocalAppStatus({
          origin: 'own',
          isPublished: true,
          localVersion: '1.0.0',
          remoteVersion: '1.0.0'
        })
      ).toBe('published')
      expect(
        resolveLocalAppStatus({
          origin: 'own',
          isPublished: true,
          localVersion: '1.1.0',
          remoteVersion: '1.0.0'
        })
      ).toBe('pending_publish')
      expect(
        resolveLocalAppStatus({
          origin: 'own',
          isPublished: true,
          localVersion: '1.0.0',
          remoteVersion: '1.1.0'
        })
      ).toBe('pending_update')
    })

    it('builtin and installed variants', () => {
      expect(
        resolveLocalAppStatus({ origin: 'builtin', localVersion: '1.0.0', remoteVersion: '1.0.0' })
      ).toBe('builtin')
      expect(
        resolveLocalAppStatus({ origin: 'builtin', localVersion: '1.1.0', remoteVersion: '1.0.0' })
      ).toBe('reset_builtin')
      expect(
        resolveLocalAppStatus({ origin: 'builtin', localVersion: '1.0.0', remoteVersion: '1.1.0' })
      ).toBe('pending_update')
      expect(
        resolveLocalAppStatus({ origin: 'installed', localVersion: '1.0.0', remoteVersion: '1.0.0' })
      ).toBe('installed')
      expect(
        resolveLocalAppStatus({ origin: 'installed', localVersion: '2.0.0', remoteVersion: '1.0.0' })
      ).toBe('reset_online')
    })
  })

  describe('resolveDiscoverStatus', () => {
    it('covers install states', () => {
      expect(resolveDiscoverStatus(undefined, '1.0.0', false)).toBe('not_installed')
      expect(resolveDiscoverStatus('1.0.0', '1.0.0', true)).toBe('installed')
      expect(resolveDiscoverStatus('1.0.0', '1.1.0', true)).toBe('pending_update')
      expect(resolveDiscoverStatus('1.2.0', '1.1.0', true)).toBe('reset_online')
    })
  })

  describe('shouldShowVersionDiff', () => {
    it('true only for mismatch statuses', () => {
      expect(shouldShowVersionDiff('pending_update')).toBe(true)
      expect(shouldShowVersionDiff('pending_publish')).toBe(true)
      expect(shouldShowVersionDiff('reset_online')).toBe(true)
      expect(shouldShowVersionDiff('published')).toBe(false)
      expect(shouldShowVersionDiff('installed')).toBe(false)
    })
  })
})

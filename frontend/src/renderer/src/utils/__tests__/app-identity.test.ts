import {
  chineseToPinyinAlnum,
  generateAppId,
  hasCjkChars,
  isAuthoredByCurrentUser,
  resolveUniqueAppId,
  resolveUsernameForAppId,
  sanitizeAppSlug,
  sanitizeAppUsername
} from '../app-identity'
import type { User } from '../../types/auth'

describe('app-identity', () => {
  describe('sanitizeAppUsername', () => {
    it('lowercases and strips non-alphanumerics', () => {
      expect(sanitizeAppUsername('Alice_Bob')).toBe('alicebob')
      expect(sanitizeAppUsername('test@ex.com')).toBe('testexcom')
    })
    it('falls back to user when empty', () => {
      expect(sanitizeAppUsername('')).toBe('user')
      expect(sanitizeAppUsername(null)).toBe('user')
    })
  })

  describe('sanitizeAppSlug', () => {
    it('slugifies display names', () => {
      expect(sanitizeAppSlug('My Cool App')).toBe('my-cool-app')
      expect(sanitizeAppSlug('  --x--  ')).toBe('x')
    })
    it('uses stable hash for CJK names and app for empty', () => {
      const a = sanitizeAppSlug('你好')
      const b = sanitizeAppSlug('你好')
      const c = sanitizeAppSlug('世界')
      expect(a).toMatch(/^app-[0-9a-z]+$/)
      expect(a).toBe(b)
      expect(a).not.toBe(c)
      expect(sanitizeAppSlug('')).toBe('app')
    })
  })

  describe('generateAppId', () => {
    it('uses cb.username.slug format without random prefix', () => {
      expect(generateAppId('demo-app', 'alice')).toBe('cb.alice.demo-app')
      expect(generateAppId('Hello World', 'Bob')).toBe('cb.bob.hello-world')
    })

    it('accepts User and applies resolve priority', () => {
      expect(
        generateAppId('demo-app', {
          id: '1',
          name: '张三',
          username: '张三',
          email: 'alice@example.com',
          avatarUrl: ''
        })
      ).toBe('cb.alice.demo-app')
    })

    it('appends suffix number when colliding with existingIds', () => {
      const existing = ['cb.alice.demo-app', 'cb.alice.demo-app-2']
      expect(generateAppId('demo-app', 'alice', existing)).toBe('cb.alice.demo-app-3')
    })
  })

  describe('resolveUniqueAppId', () => {
    it('returns baseId when no existingIds or no collision', () => {
      expect(resolveUniqueAppId('cb.alice.foo')).toBe('cb.alice.foo')
      expect(resolveUniqueAppId('cb.alice.foo', [])).toBe('cb.alice.foo')
      expect(resolveUniqueAppId('cb.alice.foo', ['cb.alice.bar'])).toBe('cb.alice.foo')
    })

    it('appends -2 for first collision and increments for subsequent collisions', () => {
      expect(resolveUniqueAppId('cb.alice.foo', ['cb.alice.foo'])).toBe('cb.alice.foo-2')
      expect(resolveUniqueAppId('cb.alice.foo', ['cb.alice.foo', 'cb.alice.foo-2'])).toBe('cb.alice.foo-3')
    })

    it('ignores null, undefined, or empty values in existingIds', () => {
      expect(resolveUniqueAppId('cb.alice.foo', [null, undefined, '', 'cb.alice.foo'])).toBe('cb.alice.foo-2')
    })
  })
  describe('resolveUsernameForAppId', () => {
    it('prefers non-Chinese username', () => {
      expect(
        resolveUsernameForAppId({
          id: '1',
          name: '张三',
          username: 'alice',
          email: 'other@example.com',
          avatarUrl: ''
        })
      ).toBe('alice')
    })

    it('falls back to email prefix when username is Chinese', () => {
      expect(
        resolveUsernameForAppId({
          id: '1',
          name: '张三',
          username: '张三',
          email: 'alice@example.com',
          avatarUrl: ''
        })
      ).toBe('alice')
    })

    it('converts Chinese username to pinyin when no email', () => {
      const handle = resolveUsernameForAppId({
        id: '1',
        name: '张三',
        username: '张三',
        avatarUrl: ''
      })
      expect(handle).toBe('zhangsan')
      expect(hasCjkChars(handle)).toBe(false)
    })

    it('returns user when nothing usable', () => {
      expect(resolveUsernameForAppId(null)).toBe('user')
      expect(
        resolveUsernameForAppId({ id: 'local', name: '', avatarUrl: '' })
      ).toBe('user')
    })
  })

  describe('chineseToPinyinAlnum', () => {
    it('maps common names', () => {
      expect(chineseToPinyinAlnum('张三')).toBe('zhangsan')
    })
  })

  describe('isAuthoredByCurrentUser', () => {
    const user: User = {
      id: 'uid-1',
      name: '张三',
      username: 'alice',
      email: 'alice@example.com',
      feishu_id: 'fs-1',
      avatarUrl: ''
    }

    it('matches by feishu_id', () => {
      expect(isAuthoredByCurrentUser({ name: 'x', feishu_id: 'fs-1' }, user)).toBe(true)
      expect(isAuthoredByCurrentUser({ name: 'x', feishu_id: 'other' }, user)).toBe(false)
    })

    it('matches by user.id stored as author.feishu_id', () => {
      expect(isAuthoredByCurrentUser({ name: 'x', feishu_id: 'uid-1' }, user)).toBe(true)
    })

    it('matches by email or name', () => {
      expect(isAuthoredByCurrentUser({ name: 'x', email: 'alice@example.com' }, user)).toBe(true)
      expect(isAuthoredByCurrentUser({ name: '张三' }, user)).toBe(true)
      expect(isAuthoredByCurrentUser({ name: 'alice' }, user)).toBe(true)
    })

    it('rejects missing author / user', () => {
      expect(isAuthoredByCurrentUser(undefined, user)).toBe(false)
      expect(isAuthoredByCurrentUser({ name: 'x', feishu_id: 'fs-1' }, null)).toBe(false)
    })

    it('matches string author', () => {
      expect(isAuthoredByCurrentUser('alice', user)).toBe(true)
      expect(isAuthoredByCurrentUser('other', user)).toBe(false)
    })
  })
})

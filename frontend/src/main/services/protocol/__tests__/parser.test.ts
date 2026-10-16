import { describe, it, expect } from 'vitest'
import { parseProtocolUrl, parseBooleanFlag } from '../parser'

describe('Protocol URL Parser', () => {
  describe('parseBooleanFlag', () => {
    it('parses truthy boolean strings correctly', () => {
      expect(parseBooleanFlag('true')).toBe(true)
      expect(parseBooleanFlag('TRUE')).toBe(true)
      expect(parseBooleanFlag('1')).toBe(true)
      expect(parseBooleanFlag('yes')).toBe(true)
      expect(parseBooleanFlag('')).toBe(true)
      expect(parseBooleanFlag(true)).toBe(true)
    })

    it('parses falsy boolean strings correctly', () => {
      expect(parseBooleanFlag('false')).toBe(false)
      expect(parseBooleanFlag('FALSE')).toBe(false)
      expect(parseBooleanFlag('0')).toBe(false)
      expect(parseBooleanFlag('no')).toBe(false)
      expect(parseBooleanFlag(false)).toBe(false)
    })

    it('uses default value for null or undefined', () => {
      expect(parseBooleanFlag(undefined, false)).toBe(false)
      expect(parseBooleanFlag(undefined, true)).toBe(true)
      expect(parseBooleanFlag(null, false)).toBe(false)
    })
  })

  describe('parseProtocolUrl', () => {
    it('parses app action with query parameters', () => {
      const url = 'clawbench://app?id=com.clawbench.builtin.env-check&silent=true&autoInstall=true'
      const parsed = parseProtocolUrl(url)

      expect(parsed.action).toBe('app')
      expect(parsed.silent).toBe(true)
      expect(parsed.params.id).toBe('com.clawbench.builtin.env-check')
      expect(parsed.params.autoInstall).toBe(true)
    })

    it('parses app action with id in path and non-silent by default', () => {
      const url = 'clawbench://app/com.clawbench.builtin.env-check'
      const parsed = parseProtocolUrl(url)

      expect(parsed.action).toBe('app')
      expect(parsed.silent).toBe(false)
      expect(parsed.params.id).toBe('com.clawbench.builtin.env-check')
      expect(parsed.params.autoInstall).toBe(false)
    })

    it('normalizes appId and auto_install aliases', () => {
      const url = 'clawbench://app?appId=my.custom.app&auto_install=1&silent=1'
      const parsed = parseProtocolUrl(url)

      expect(parsed.action).toBe('app')
      expect(parsed.params.id).toBe('my.custom.app')
      expect(parsed.params.autoInstall).toBe(true)
      expect(parsed.silent).toBe(true)
    })

    it('parses query-based action format (clawbench://?action=app...)', () => {
      const url = 'clawbench://?action=app&id=com.clawbench.builtin.feedback'
      const parsed = parseProtocolUrl(url)

      expect(parsed.action).toBe('app')
      expect(parsed.params.id).toBe('com.clawbench.builtin.feedback')
    })

    it('parses JSON formatted params', () => {
      const jsonParams = JSON.stringify({ branch: 'release-1.0', retry: 3 })
      const url = `clawbench://app?id=com.test.tool&params=${encodeURIComponent(jsonParams)}`
      const parsed = parseProtocolUrl(url)

      expect(parsed.action).toBe('app')
      expect(parsed.params.id).toBe('com.test.tool')
      expect(parsed.params.appParams).toEqual({ branch: 'release-1.0', retry: 3 })
    })

    it('handles legacy auth/callback URL', () => {
      const url = 'clawbench://auth/callback?code=abc123xyz&state=feishu'
      const parsed = parseProtocolUrl(url)

      expect(parsed.action).toBe('auth')
      expect(parsed.params.subPath).toBe('callback')
      expect(parsed.params.code).toBe('abc123xyz')
      expect(parsed.params.state).toBe('feishu')
    })
    it('handles quoted and trailing slash in auth/callback URL', () => {
      const url = '"clawbench://auth/callback?code=abc123xyz&token=jwt.token.val&appId=cli_12345/"'
      const parsed = parseProtocolUrl(url)

      expect(parsed.action).toBe('auth')
      expect(parsed.params.subPath).toBe('callback')
      expect(parsed.params.code).toBe('abc123xyz')
      expect(parsed.params.token).toBe('jwt.token.val')
      expect(parsed.params.id).toBe('cli_12345')
    })

    it('handles triple-slash auth/callback URL: clawbench:///auth/callback', () => {
      const url = 'clawbench:///auth/callback?token=test_jwt'
      const parsed = parseProtocolUrl(url)

      expect(parsed.action).toBe('auth')
      expect(parsed.params.subPath).toBe('callback')
      expect(parsed.params.token).toBe('test_jwt')
    })

    it('handles legacy install URL: clawbench://install/{appId}?name=test', () => {
      const url = 'clawbench://install/com.mycorp.deploy-tool?name=DeployApp'
      const parsed = parseProtocolUrl(url)

      expect(parsed.action).toBe('install')
      expect(parsed.params.id).toBe('com.mycorp.deploy-tool')
      expect(parsed.params.name).toBe('DeployApp')
    })
  })
})

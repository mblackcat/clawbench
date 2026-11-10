import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: vi.fn(() => '/tmp') } }))

import { sanitizeLogString } from '../remote-task-logger'

describe('sanitizeLogString', () => {
  it('redacts key=value secrets without leaking the value', () => {
    const out = sanitizeLogString('url?token=abc123&password=hunter2 api_key=zzz')
    expect(out).not.toContain('abc123')
    expect(out).not.toContain('hunter2')
    expect(out).not.toContain('zzz')
    expect(out).toContain('token=***')
    expect(out).toContain('password=***')
  })

  it('redacts JSON-style secrets', () => {
    const out = sanitizeLogString('{"token":"s3cr3t","name":"ok"}')
    expect(out).not.toContain('s3cr3t')
    expect(out).toContain('"name":"ok"')
  })

  it('redacts bearer headers, CLI passwords and URL credentials', () => {
    expect(sanitizeLogString('Authorization: Bearer eyJabc')).toBe('Authorization: Bearer ***')
    expect(sanitizeLogString('svn co --password p4ss url')).not.toContain('p4ss')
    expect(sanitizeLogString('https://user:pw@example.com/repo')).toBe('https://user:***@example.com/repo')
  })

  it('leaves ordinary text alone', () => {
    expect(sanitizeLogString('Cleaning 42 files in /tmp/work')).toBe('Cleaning 42 files in /tmp/work')
  })
})

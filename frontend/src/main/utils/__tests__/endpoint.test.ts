import { describe, it, expect } from 'vitest'
import { normalizeOpenAIBaseURL, normalizeAnthropicBaseURL } from '../endpoint'

describe('normalizeOpenAIBaseURL', () => {
  it('appends /v1 to a bare origin', () => {
    expect(normalizeOpenAIBaseURL('https://llm-api-qa.boomingcb.com')).toBe(
      'https://llm-api-qa.boomingcb.com/v1'
    )
  })

  it('appends /v1 to a bare origin with trailing slash', () => {
    expect(normalizeOpenAIBaseURL('https://llm-api-qa.boomingcb.com/')).toBe(
      'https://llm-api-qa.boomingcb.com/v1'
    )
  })

  it('keeps an endpoint that already has /v1', () => {
    expect(normalizeOpenAIBaseURL('https://api.openai.com/v1')).toBe('https://api.openai.com/v1')
  })

  it('keeps custom path prefixes', () => {
    expect(normalizeOpenAIBaseURL('https://ark.cn-beijing.volces.com/api/v3')).toBe(
      'https://ark.cn-beijing.volces.com/api/v3'
    )
    expect(normalizeOpenAIBaseURL('https://co.yes.vg/team/v1')).toBe('https://co.yes.vg/team/v1')
    expect(normalizeOpenAIBaseURL('https://dashscope.aliyuncs.com/compatible-mode/v1')).toBe(
      'https://dashscope.aliyuncs.com/compatible-mode/v1'
    )
  })

  it('strips a pasted full request path', () => {
    expect(normalizeOpenAIBaseURL('https://relay.example.com/v1/chat/completions')).toBe(
      'https://relay.example.com/v1'
    )
    expect(normalizeOpenAIBaseURL('https://relay.example.com/chat/completions')).toBe(
      'https://relay.example.com/v1'
    )
    expect(normalizeOpenAIBaseURL('https://relay.example.com/v1/models')).toBe(
      'https://relay.example.com/v1'
    )
    expect(normalizeOpenAIBaseURL('https://relay.example.com/v1/responses')).toBe(
      'https://relay.example.com/v1'
    )
  })

  it('returns undefined for empty input', () => {
    expect(normalizeOpenAIBaseURL('')).toBeUndefined()
    expect(normalizeOpenAIBaseURL('   ')).toBeUndefined()
    expect(normalizeOpenAIBaseURL(undefined)).toBeUndefined()
  })

  it('trims surrounding whitespace', () => {
    expect(normalizeOpenAIBaseURL('  https://api.openai.com/v1  ')).toBe('https://api.openai.com/v1')
  })

  it('leaves non-URL input untouched', () => {
    expect(normalizeOpenAIBaseURL('localhost:1234/v1')).toBe('localhost:1234/v1')
  })
})

describe('normalizeAnthropicBaseURL', () => {
  it('strips a trailing /v1 (SDK appends /v1/messages itself)', () => {
    expect(normalizeAnthropicBaseURL('https://api.anthropic.com/v1')).toBe(
      'https://api.anthropic.com'
    )
    expect(normalizeAnthropicBaseURL('https://api.neorouter.ai/v1')).toBe(
      'https://api.neorouter.ai'
    )
  })

  it('keeps a bare origin', () => {
    expect(normalizeAnthropicBaseURL('https://api.anthropic.com')).toBe('https://api.anthropic.com')
  })

  it('strips a pasted full messages path', () => {
    expect(normalizeAnthropicBaseURL('https://relay.example.com/v1/messages')).toBe(
      'https://relay.example.com'
    )
  })

  it('strips trailing slashes', () => {
    expect(normalizeAnthropicBaseURL('https://api.anthropic.com/v1/')).toBe(
      'https://api.anthropic.com'
    )
  })

  it('keeps custom path prefixes that do not end in /v1', () => {
    expect(normalizeAnthropicBaseURL('https://gateway.example.com/anthropic')).toBe(
      'https://gateway.example.com/anthropic'
    )
  })

  it('returns undefined for empty input', () => {
    expect(normalizeAnthropicBaseURL('')).toBeUndefined()
    expect(normalizeAnthropicBaseURL(undefined)).toBeUndefined()
  })
})

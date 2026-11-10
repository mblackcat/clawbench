import { describe, it, expect } from 'vitest'
import { parseModelSelectValue } from '../model-select-value'

describe('parseModelSelectValue', () => {
  it('parses builtin ids, keeping colons inside the model id', () => {
    expect(parseModelSelectValue('builtin:gpt-4o-mini')).toEqual({ source: 'builtin', modelId: 'gpt-4o-mini' })
    // admin system model option id: <configId>::<upstreamModelId>
    expect(parseModelSelectValue('builtin:cfg-1::gpt-x')).toEqual({ source: 'builtin', modelId: 'cfg-1::gpt-x' })
  })

  it('parses local ids, splitting only the config id', () => {
    expect(parseModelSelectValue('local:abc:gpt-4o')).toEqual({ source: 'local', configId: 'abc', modelId: 'gpt-4o' })
    expect(parseModelSelectValue('local:abc:qwen2:7b')).toEqual({ source: 'local', configId: 'abc', modelId: 'qwen2:7b' })
  })

  it('rejects malformed values', () => {
    for (const v of [undefined, null, '', 'builtin:', 'local:', 'local:abc', 'local::m', 'local:abc:', 'other:x']) {
      expect(parseModelSelectValue(v)).toBeNull()
    }
  })
})

import { beforeEach, describe, expect, it } from 'vitest'
import type { ParamDef } from '../../types/subapp'
import {
  DynamicOptionsError,
  buildDynamicOptionsCacheKey,
  clearDynamicOptionsCache,
  getDynamicOptionsCache,
  parseDynamicOptionsResult,
  reconcileDynamicOptionValue,
  setDynamicOptionsCache
} from '../subapp-dynamic-options'

const modelParam: ParamDef = {
  name: 'model',
  type: 'enum',
  label: 'Model',
  options_slot: 'models'
}

describe('dynamic sub-app options', () => {
  beforeEach(() => {
    clearDynamicOptionsCache()
  })

  it('validates, de-duplicates, and keeps a valid default', () => {
    expect(
      parseDynamicOptionsResult({
        options: ['a', 'b', 'a'],
        default: 'b'
      })
    ).toEqual({
      options: ['a', 'b'],
      default: 'b'
    })
  })

  it('drops a default that is not in the refreshed options', () => {
    expect(
      parseDynamicOptionsResult({
        options: ['a', 'b'],
        default: 'gone'
      })
    ).toEqual({ options: ['a', 'b'] })
  })

  it.each([
    undefined,
    null,
    [],
    {},
    { options: 'a' },
    { options: ['ok', 3] },
    { options: [''] },
    { options: ['   '] }
  ])('rejects malformed results: %j', (data) => {
    expect(() => parseDynamicOptionsResult(data)).toThrow(DynamicOptionsError)
    try {
      parseDynamicOptionsResult(data)
    } catch (error) {
      expect((error as DynamicOptionsError).code).toBe('invalid')
    }
  })

  it('reports an empty option list separately', () => {
    expect.assertions(2)
    try {
      parseDynamicOptionsResult({ options: [] })
    } catch (error) {
      expect(error).toBeInstanceOf(DynamicOptionsError)
      expect((error as DynamicOptionsError).code).toBe('empty')
    }
  })

  it('uses the current value, resolver default, then first option', () => {
    const result = { options: ['a', 'b'], default: 'b' }

    expect(reconcileDynamicOptionValue('a', result)).toBe('a')
    expect(reconcileDynamicOptionValue('gone', result)).toBe('b')
    expect(reconcileDynamicOptionValue(undefined, { options: ['a'] })).toBe('a')
    expect(reconcileDynamicOptionValue(undefined, { options: [] })).toBeUndefined()
  })

  it('isolates cache entries by App version, parameter, and slot', () => {
    const v1 = buildDynamicOptionsCacheKey('app', '1.0.0', modelParam)
    const v2 = buildDynamicOptionsCacheKey('app', '2.0.0', modelParam)
    const otherParam = buildDynamicOptionsCacheKey('app', '1.0.0', {
      ...modelParam,
      name: 'secondary_model'
    })
    const otherSlot = buildDynamicOptionsCacheKey('app', '1.0.0', {
      ...modelParam,
      options_slot: 'other-models'
    })

    setDynamicOptionsCache(v1, { options: ['a'] })

    expect(getDynamicOptionsCache(v1)).toEqual({ options: ['a'] })
    expect(getDynamicOptionsCache(v2)).toBeUndefined()
    expect(getDynamicOptionsCache(otherParam)).toBeUndefined()
    expect(getDynamicOptionsCache(otherSlot)).toBeUndefined()
  })

  it('clones cached options on write and read', () => {
    const key = buildDynamicOptionsCacheKey('app', '1.0.0', modelParam)
    const source = { options: ['a'] }

    setDynamicOptionsCache(key, source)
    source.options.push('mutated-source')
    const firstRead = getDynamicOptionsCache(key)!
    firstRead.options.push('mutated-read')

    expect(getDynamicOptionsCache(key)).toEqual({ options: ['a'] })
  })
})

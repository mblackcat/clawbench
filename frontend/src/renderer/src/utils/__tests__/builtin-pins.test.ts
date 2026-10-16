import { describe, expect, it } from 'vitest'
import { mergeAdminPins } from '../builtin-pins'

const B = (k: string): string => `com.clawbench.builtin.${k}`

describe('mergeAdminPins', () => {
  it('keeps the user pins (incl. builtins) and adds admin pins', () => {
    expect(mergeAdminPins(['user.app', B('mine')], [B('admin')], [])).toEqual([B('admin'), 'user.app', B('mine')])
  })

  it('drops only pins the admin withdrew', () => {
    expect(mergeAdminPins([B('old'), 'user.app', B('mine')], [], [B('old')])).toEqual(['user.app', B('mine')])
  })

  it('dedupes a builtin pinned by both admin and user', () => {
    expect(mergeAdminPins([B('x'), 'a'], [B('x')], [B('x')])).toEqual([B('x'), 'a'])
  })

  it('is stable when nothing changed', () => {
    const current = [B('admin'), 'a', B('mine')]
    expect(mergeAdminPins(current, [B('admin')], [B('admin')])).toEqual(current)
  })
})

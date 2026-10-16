import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../pref', () => ({ supportsViewTransitions: () => true, prefersReducedMotion: () => false }))

import { withViewTransition, isViewTransitionInFlight } from '../view-transition'

/** Loosely-typed handle so tests can install / remove a fake API. */
const doc = document as unknown as { startViewTransition?: unknown }

afterEach(() => {
  delete doc.startViewTransition
})

describe('withViewTransition', () => {
  it('calls startViewTransition with document as receiver and runs the update once', async () => {
    let receiver: unknown
    let resolveFinished!: () => void
    doc.startViewTransition = function (this: unknown, cb: () => void | Promise<void>) {
      // Native implementation throws "Illegal invocation" without a Document receiver
      if (!(this instanceof Document)) throw new TypeError('Illegal invocation')
      receiver = this
      const done = Promise.resolve().then(cb)
      return {
        updateCallbackDone: done,
        ready: done,
        finished: new Promise<void>((r) => (resolveFinished = r))
      }
    }
    const update = vi.fn()
    withViewTransition(update)
    expect(isViewTransitionInFlight()).toBe(true)
    await Promise.resolve()
    await Promise.resolve()
    expect(receiver).toBe(document)
    expect(update).toHaveBeenCalledTimes(1)
    resolveFinished()
    await new Promise((r) => setTimeout(r, 0))
    expect(isViewTransitionInFlight()).toBe(false)
  })

  it('awaits async updates and swallows a rejected update promise', async () => {
    let cbResult: unknown
    doc.startViewTransition = function (cb: () => void | Promise<void>) {
      cbResult = cb()
      const done = Promise.resolve(cbResult as Promise<void>)
      return { updateCallbackDone: done, ready: done, finished: done }
    }
    const update = vi.fn(() => Promise.reject(new Error('nav failed')))
    withViewTransition(update)
    expect(update).toHaveBeenCalledTimes(1)
    expect(cbResult).toBeInstanceOf(Promise)
    await new Promise((r) => setTimeout(r, 0))
    expect(isViewTransitionInFlight()).toBe(false)
  })

  it('falls back to a direct update when starting throws', () => {
    doc.startViewTransition = () => {
      throw new Error('boom')
    }
    const update = vi.fn()
    withViewTransition(update)
    expect(update).toHaveBeenCalledTimes(1)
    expect(isViewTransitionInFlight()).toBe(false)
  })

  it('falls back when the API is missing', () => {
    const update = vi.fn()
    withViewTransition(update)
    expect(update).toHaveBeenCalledTimes(1)
  })
})

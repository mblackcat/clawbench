/**
 * Async message queue used as the streaming `prompt` input to
 * `@anthropic-ai/claude-agent-sdk`'s `query()`.
 *
 * Instead of starting a fresh `query()` per user turn (the old, fragile design),
 * the SDK session manager creates ONE long-lived query with `prompt: <queue>` and
 * pushes each user message into the queue. The same query keeps consuming turns —
 * true multi-turn streaming, exactly like Clay (see
 * D:\repos\vx-tools\clay\lib\sdk-message-queue.js and yoke/adapters/claude.js).
 *
 * The queue ends only when the session is closed; until then the query blocks on
 * `next()` waiting for the next user message.
 *
 * Generic over T so callers can specialize it with the SDK's exact message type
 * (SDKUserMessage) without coupling this module to the SDK.
 */

export interface MessageQueue<T = any> {
  /** Append a user turn. Resolves a pending consumer if one is waiting. */
  push(msg: T): void
  /** Signal that no more messages will arrive — the query completes normally. */
  end(): void
  [Symbol.asyncIterator](): AsyncIterator<T>
}

export function createMessageQueue<T = any>(): MessageQueue<T> {
  const queue: T[] = []
  let waiting: ((r: IteratorResult<T>) => void) | null = null
  let ended = false

  return {
    push(msg: T): void {
      if (waiting) {
        const resolve = waiting
        waiting = null
        resolve({ value: msg, done: false })
      } else {
        queue.push(msg)
      }
    },
    end(): void {
      ended = true
      if (waiting) {
        const resolve = waiting
        waiting = null
        resolve({ value: undefined, done: true })
      }
    },
    [Symbol.asyncIterator](): AsyncIterator<T> {
      return {
        next(): Promise<IteratorResult<T>> {
          if (queue.length > 0) {
            return Promise.resolve({ value: queue.shift() as T, done: false })
          }
          if (ended) {
            return Promise.resolve({ value: undefined, done: true })
          }
          return new Promise<IteratorResult<T>>((resolve) => {
            waiting = resolve
          })
        },
      }
    },
  }
}


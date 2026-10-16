/**
 * Replay gate for remounting terminals.
 *
 * A remounting terminal subscribes to live `pty:data` first, then fetches the
 * raw ring-buffer snapshot. Chunks that arrive in between are queued; without
 * offsets they would be written after the snapshot even though the snapshot
 * already contains them (duplicated output). The main process stamps every live
 * chunk with the session output offset it *ends* at, and the snapshot with the
 * offset it ends at, so queued chunks can be dropped or trimmed precisely.
 */

export interface PtyChunk {
  data: string
  /** Session output offset at the end of this chunk (absent from older mains) */
  offset?: number
}

/**
 * Part of `chunk` not already contained in a snapshot ending at
 * `snapshotOffset`. Returns '' when fully covered. Chunks without an offset (or
 * an unknown snapshot offset) are passed through unchanged.
 */
export function trimChunkAfterSnapshot(chunk: PtyChunk, snapshotOffset: number | null | undefined): string {
  if (typeof snapshotOffset !== 'number' || typeof chunk.offset !== 'number') return chunk.data
  if (chunk.offset <= snapshotOffset) return ''
  const start = chunk.offset - chunk.data.length
  if (start >= snapshotOffset) return chunk.data
  return chunk.data.slice(snapshotOffset - start)
}

export interface PtyReplayGate {
  /** Feed a live chunk: written immediately once released, queued before. */
  push: (chunk: PtyChunk) => void
  /**
   * Release queued chunks. Pass the snapshot offset that was just replayed to
   * drop chunks it already contains; omit it when nothing was replayed.
   */
  release: (snapshotOffset?: number | null) => void
}

export function createPtyReplayGate(write: (data: string) => void): PtyReplayGate {
  let released = false
  let snapshot: number | null = null
  const queued: PtyChunk[] = []

  const emit = (chunk: PtyChunk): void => {
    const data = trimChunkAfterSnapshot(chunk, snapshot)
    // Once output moves past the snapshot nothing later can overlap it; stop
    // filtering so a restarted PTY (offsets reset to 0) isn't swallowed.
    if (snapshot !== null && typeof chunk.offset === 'number' && chunk.offset > snapshot) snapshot = null
    if (data) write(data)
  }

  return {
    push(chunk) {
      if (released) emit(chunk)
      else queued.push(chunk)
    },
    release(snapshotOffset) {
      if (released) return
      released = true
      snapshot = typeof snapshotOffset === 'number' ? snapshotOffset : null
      for (const chunk of queued.splice(0)) emit(chunk)
    }
  }
}

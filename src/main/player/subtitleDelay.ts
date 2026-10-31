import { clampOffset } from '@shared/subtitleTiming'
import type { Db } from '../db'
import { getOffset, setOffset } from '../subtitles/transforms'

// The showing subtitle's timing fix, applied through mpv's sub-delay. mpv gets
// every change at once; the database gets the last one after a short pause.
export function createSubtitleDelay(deps: {
  db: Db
  setDelay(s: number): Promise<void>
  emit(offset: number | null): void
  now(): number
  saveAfterMs?: number
}) {
  const saveAfter = deps.saveAfterMs ?? 500
  let cur: { videoId: number; key: string; offset: number } | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending: { videoId: number; key: string; offset: number } | null = null

  function flush() {
    if (timer) clearTimeout(timer)
    timer = null
    if (pending) setOffset(deps.db, pending.videoId, pending.key, pending.offset, deps.now())
    pending = null
  }

  async function apply(offset: number): Promise<number | null> {
    if (!cur) return null
    cur = { ...cur, offset: clampOffset(offset) }
    pending = { ...cur }
    if (timer) clearTimeout(timer)
    timer = setTimeout(flush, saveAfter)
    await deps.setDelay(cur.offset)
    deps.emit(cur.offset)
    return cur.offset
  }

  return {
    // Every subtitle change (including Off and a new file) comes through here.
    async select(videoId: number, key: string | null): Promise<void> {
      flush()
      cur = key ? { videoId, key, offset: getOffset(deps.db, videoId, key) } : null
      await deps.setDelay(cur?.offset ?? 0)
      deps.emit(cur?.offset ?? null)
    },
    // The file is changing: save what is pending and forget the selection, so nothing
    // lands on the old file's subtitle before the new one's pick.
    clear(): void {
      flush()
      cur = null
      deps.emit(null)
      void deps.setDelay(0)
    },
    nudge: (deltaS: number) => apply((cur?.offset ?? 0) + deltaS),
    set: (offset: number) => apply(offset),
    current: () => (cur ? { ...cur } : null),
    flush
  }
}

export type SubtitleDelay = ReturnType<typeof createSubtitleDelay>

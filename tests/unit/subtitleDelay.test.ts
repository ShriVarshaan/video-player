import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDb, type Db } from '../../src/main/db'
import { createSubtitleDelay } from '../../src/main/player/subtitleDelay'
import { getOffset, setOffset } from '../../src/main/subtitles/transforms'

let db: Db
let delays: number[]
let emits: (number | null)[]
let delay: ReturnType<typeof createSubtitleDelay>

beforeEach(() => {
  vi.useFakeTimers()
  db = openDb(':memory:')
  db.exec(`INSERT INTO library_folders (id, path, added_at) VALUES (1, 'D:/L', 0);
    INSERT INTO videos (id, folder_id, path, size_bytes, mtime_ms, wall_key, parsed_title, added_at) VALUES
      (7, 1, 'D:/L/a.mkv', 1, 0, 0, 'A', 0), (8, 1, 'D:/L/b.mkv', 1, 0, 1, 'B', 0)`)
  delays = []
  emits = []
  delay = createSubtitleDelay({
    db,
    setDelay: async (s) => void delays.push(s),
    emit: (o) => emits.push(o),
    now: () => 1000
  })
})
afterEach(() => vi.useRealTimers())

describe('select', () => {
  it('applies the stored offset of the chosen subtitle', async () => {
    setOffset(db, 7, 'embedded:3', 1.5, 0)
    await delay.select(7, 'embedded:3')
    expect(delays).toEqual([1.5])
    expect(emits).toEqual([1.5])
    expect(delay.current()).toEqual({ videoId: 7, key: 'embedded:3', offset: 1.5 })
  })

  it('sets 0 and reports nothing for Off', async () => {
    await delay.select(7, null)
    expect(delays).toEqual([0])
    expect(emits).toEqual([null])
    expect(delay.current()).toBeNull()
  })
})

describe('nudge', () => {
  it('does nothing with no subtitle', async () => {
    expect(await delay.nudge(0.05)).toBeNull()
    expect(delays).toEqual([])
  })

  it('reaches mpv at once and is saved once, after a pause', async () => {
    await delay.select(7, 'embedded:3')
    for (let i = 0; i < 5; i++) await delay.nudge(0.05)
    expect(delays).toEqual([0, 0.05, 0.1, 0.15, 0.2, 0.25])
    expect(getOffset(db, 7, 'embedded:3')).toBe(0)
    vi.advanceTimersByTime(500)
    expect(getOffset(db, 7, 'embedded:3')).toBe(0.25)
  })

  it('clamps to ±600 s', async () => {
    await delay.select(7, 'embedded:3')
    expect(await delay.nudge(1000)).toBe(600)
  })

  it('saves a pending change before another subtitle is selected', async () => {
    await delay.select(7, 'embedded:3')
    await delay.nudge(0.5)
    await delay.select(7, 'embedded:4')
    expect(getOffset(db, 7, 'embedded:3')).toBe(0.5)
    expect(delays.at(-1)).toBe(0)
  })

  it('flush writes a pending change at once', async () => {
    await delay.select(7, 'embedded:3')
    await delay.nudge(-0.5)
    delay.flush()
    expect(getOffset(db, 7, 'embedded:3')).toBe(-0.5)
  })
})

describe('set', () => {
  it('replaces the offset (sync to a line, reset)', async () => {
    await delay.select(8, 'file:x')
    expect(await delay.set(4)).toBe(4)
    expect(await delay.set(0)).toBe(0)
    delay.flush()
    expect(getOffset(db, 8, 'file:x')).toBe(0)
    expect(emits).toEqual([0, 4, 0])
  })
})

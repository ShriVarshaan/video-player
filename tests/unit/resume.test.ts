import { beforeEach, describe, expect, it } from 'vitest'
import { openDb, type Db } from '../../src/main/db'
import { savePosition } from '../../src/main/player/resume'

let db: Db
beforeEach(() => {
  db = openDb(':memory:')
  db.exec(`INSERT INTO library_folders (id, path, added_at) VALUES (1, 'D:/L', 0);
    INSERT INTO videos (id, folder_id, path, size_bytes, mtime_ms, wall_key, parsed_title, added_at)
      VALUES (7, 1, 'D:/L/a.mkv', 1, 0, 0, 'A', 0)`)
})

const row = () =>
  ({ ...db.prepare('SELECT position_s, duration_s, completed, last_played_at FROM playback_state WHERE video_id = 7').get() })

describe('savePosition', () => {
  it('writes position, duration and last played time', () => {
    savePosition(db, { videoId: 7, positionS: 42.5, durationS: 100 }, 1000)
    expect(row()).toEqual({ position_s: 42.5, duration_s: 100, completed: 0, last_played_at: 1000 })
    savePosition(db, { videoId: 7, positionS: 50, durationS: 100 }, 2000)
    expect(row()).toEqual({ position_s: 50, duration_s: 100, completed: 0, last_played_at: 2000 })
  })

  it('marks completed at 95 % of the duration', () => {
    savePosition(db, { videoId: 7, positionS: 94.9, durationS: 100 }, 1)
    expect(row()['completed']).toBe(0)
    savePosition(db, { videoId: 7, positionS: 95, durationS: 100 }, 2)
    expect(row()['completed']).toBe(1)
  })

  it('marks completed at the end of the file', () => {
    savePosition(db, { videoId: 7, positionS: 10, durationS: null, ended: true }, 1)
    expect(row()['completed']).toBe(1)
  })

  it('un-marks completed when a rewatch saves a lower position', () => {
    savePosition(db, { videoId: 7, positionS: 100, durationS: 100, ended: true }, 1)
    savePosition(db, { videoId: 7, positionS: 5, durationS: 100 }, 2)
    expect(row()['completed']).toBe(0)
  })
})

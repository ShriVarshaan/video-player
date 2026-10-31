import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { openDb, type Db } from '../../src/main/db'
import { getOffset, setOffset, subtitleKeyForEmbedded, subtitleKeyForFile } from '../../src/main/subtitles/transforms'

let db: Db
beforeEach(() => {
  db = openDb(':memory:')
  db.exec(`INSERT INTO library_folders (id, path, added_at) VALUES (1, 'D:/L', 0);
    INSERT INTO videos (id, folder_id, path, size_bytes, mtime_ms, wall_key, parsed_title, added_at) VALUES
      (7, 1, 'D:/L/a.mkv', 1, 0, 0, 'A', 0),
      (8, 1, 'D:/L/b.mkv', 1, 0, 1, 'B', 0)`)
})

const rows = () => db.prepare('SELECT video_id, subtitle_key, scale, offset_s, source, updated_at FROM subtitle_transforms').all().map((r) => ({ ...r }))

describe('subtitle keys', () => {
  it('names a file by the sha1 of its path and an embedded track by its stream index', () => {
    expect(subtitleKeyForFile('D:/L/a.en.srt')).toBe(`file:${createHash('sha1').update('D:/L/a.en.srt').digest('hex')}`)
    expect(subtitleKeyForEmbedded(3)).toBe('embedded:3')
  })
})

describe('offsets', () => {
  it('is 0 with nothing stored', () => {
    expect(getOffset(db, 7, 'embedded:2')).toBe(0)
  })

  it('stores, updates and reads back one row', () => {
    setOffset(db, 7, 'embedded:2', 0.35, 1000)
    setOffset(db, 7, 'embedded:2', -1.2, 2000)
    expect(getOffset(db, 7, 'embedded:2')).toBe(-1.2)
    expect(rows()).toEqual([{ video_id: 7, subtitle_key: 'embedded:2', scale: 1, offset_s: -1.2, source: 'manual', updated_at: 2000 }])
  })

  it('removes the row at 0', () => {
    setOffset(db, 7, 'embedded:2', 0.35, 1000)
    setOffset(db, 7, 'embedded:2', 0, 2000)
    expect(rows()).toEqual([])
  })

  it('keeps each video and subtitle apart', () => {
    setOffset(db, 7, 'embedded:2', 1, 0)
    expect(getOffset(db, 7, 'embedded:3')).toBe(0)
    expect(getOffset(db, 8, 'embedded:2')).toBe(0)
  })

  it('goes with the video', () => {
    setOffset(db, 7, 'embedded:2', 1, 0)
    db.exec('DELETE FROM videos WHERE id = 7')
    expect(rows()).toEqual([])
  })
})

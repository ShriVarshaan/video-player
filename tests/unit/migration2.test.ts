import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDb, schemaVersion } from '../../src/main/db'
import { migrations } from '../../src/main/db/migrations'

const now = 1_700_000_000_000
let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vp-m2-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function v1WithData(file: string) {
  const db = openDb(file, [migrations[0]!])
  db.exec(`
    INSERT INTO library_folders (id, path, added_at) VALUES (1, 'D:/Movies', ${now});
    INSERT INTO movies (id, folder_id, path, size_bytes, mtime_ms, wall_key, parsed_title, added_at)
      VALUES (10, 1, 'D:/Movies/The.Matrix.1999.mkv', 1, ${now}, 42, 'The Matrix', ${now});
    INSERT INTO playback_state (movie_id, position_s, last_played_at) VALUES (10, 120, ${now});
    INSERT INTO subtitle_transforms (movie_id, subtitle_key, source, updated_at) VALUES (10, 'embedded:2', 'manual', ${now});
  `)
  db.close()
}

describe('migration 2', () => {
  it('moves movie rows, progress and offsets onto videos', () => {
    const file = join(dir, 'library.db')
    v1WithData(file)
    const db = openDb(file)
    expect(schemaVersion(db)).toBe(2)
    expect({ ...db.prepare('SELECT kind, parsed_title FROM videos WHERE id = 10').get() }).toEqual({
      kind: 'movie',
      parsed_title: 'The Matrix'
    })
    expect({ ...db.prepare('SELECT video_id, position_s FROM playback_state').get() }).toEqual({
      video_id: 10,
      position_s: 120
    })
    expect({ ...db.prepare('SELECT video_id FROM subtitle_transforms').get() }).toEqual({ video_id: 10 })
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    db.close()
  })

  it('still cascades a removed folder to progress', () => {
    const file = join(dir, 'library.db')
    v1WithData(file)
    const db = openDb(file)
    db.exec('DELETE FROM library_folders WHERE id = 1')
    expect(db.prepare('SELECT count(*) AS n FROM playback_state').get()).toEqual({ n: 0 })
    db.close()
  })

  it('rejects an unknown video kind', () => {
    const db = openDb(':memory:')
    db.exec(`INSERT INTO library_folders (id, path, added_at) VALUES (1, 'D:/M', 0)`)
    expect(() =>
      db.exec(`INSERT INTO videos (folder_id, path, size_bytes, mtime_ms, wall_key, parsed_title, added_at, kind)
               VALUES (1, 'D:/M/a.mkv', 1, 0, 1, 'a', 0, 'clip')`)
    ).toThrow(/CHECK constraint failed/)
  })
})

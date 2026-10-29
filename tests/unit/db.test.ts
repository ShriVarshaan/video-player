import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseAppError } from '@shared/appError'
import { openDb, schemaVersion, tx, type Db } from '../../src/main/db'
import { migrations } from '../../src/main/db/migrations'

const TABLES = [
  'credits',
  'genres',
  'images',
  'library_folders',
  'people',
  'playback_state',
  'settings',
  'show_credits',
  'subtitle_transforms',
  'tmdb_episodes',
  'tmdb_movie_genres',
  'tmdb_movies',
  'tmdb_seasons',
  'tmdb_show_genres',
  'tmdb_shows',
  'videos'
]

const now = 1_700_000_000_000

function count(db: Db, table: string): number {
  return Number((db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n)
}

function seedMovie(db: Db) {
  db.exec(`
    INSERT INTO library_folders (id, path, added_at) VALUES (1, 'D:\\Movies', ${now});
    INSERT INTO tmdb_movies (tmdb_id, title, fetched_at) VALUES (603, 'The Matrix', ${now});
    INSERT INTO videos (id, folder_id, path, size_bytes, mtime_ms, wall_key, parsed_title, tmdb_id, added_at)
      VALUES (10, 1, 'D:\\Movies\\The.Matrix.1999.mkv', 1, ${now}, 42, 'The Matrix', 603, ${now});
    INSERT INTO playback_state (video_id, position_s, last_played_at) VALUES (10, 120, ${now});
    INSERT INTO subtitle_transforms (video_id, subtitle_key, source, updated_at) VALUES (10, 'embedded:2', 'manual', ${now});
  `)
}

function caught(fn: () => unknown): unknown {
  try {
    fn()
  } catch (e) {
    return e
  }
  throw new Error('expected a throw')
}

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vp-db-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('openDb', () => {
  it('migrates a new database to the latest version with every table', () => {
    const db = openDb(':memory:')
    expect(schemaVersion(db)).toBe(migrations.length)
    const names = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
      .all()
      .map((r) => (r as { name: string }).name)
    expect(names).toEqual(TABLES)
  })

  it('turns on foreign keys', () => {
    const db = openDb(':memory:')
    expect(db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 })
  })

  it('reopening a file database keeps data and version', () => {
    const file = join(dir, 'library.db')
    const a = openDb(file)
    a.exec(`INSERT INTO settings (key, value) VALUES ('k', '1')`)
    a.close()
    const b = openDb(file)
    expect(schemaVersion(b)).toBe(migrations.length)
    expect(count(b, 'settings')).toBe(1)
    b.close()
  })

  it('opens under a path with spaces and non-ASCII characters, in WAL mode', () => {
    const file = join(dir, 'vp test Zoë ünï', 'library.db')
    const db = openDb(file)
    expect(schemaVersion(db)).toBe(migrations.length)
    expect(db.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' })
    db.close()
  })

  it('refuses a database from a newer app version and leaves it untouched', () => {
    const file = join(dir, 'library.db')
    const raw = new DatabaseSync(file)
    raw.exec('PRAGMA user_version = 99')
    raw.close()

    const e = caught(() => openDb(file))
    expect(parseAppError(e)?.code).toBe('db_too_new')

    const check = new DatabaseSync(file)
    expect(check.prepare('PRAGMA user_version').get()).toEqual({ user_version: 99 })
    check.close()
  })

  it('rolls back a migration that fails halfway', () => {
    const file = join(dir, 'library.db')
    const broken = [migrations[0]!, 'CREATE TABLE x (a); THIS IS NOT SQL;']
    const e = caught(() => openDb(file, broken))
    expect(parseAppError(e)?.code).toBe('db_migration_failed')

    const db = openDb(file, [migrations[0]!])
    expect(schemaVersion(db)).toBe(1)
    expect(db.prepare(`SELECT name FROM sqlite_master WHERE name = 'x'`).get()).toBeUndefined()
    db.close()
  })
})

describe('schema', () => {
  it('cascades a removed folder to its videos and their per-video rows', () => {
    const db = openDb(':memory:')
    seedMovie(db)
    db.exec('DELETE FROM library_folders WHERE id = 1')
    for (const t of ['videos', 'playback_state', 'subtitle_transforms']) {
      expect(count(db, t)).toBe(0)
    }
  })

  it('clears videos.tmdb_id when the TMDB record is removed', () => {
    const db = openDb(':memory:')
    seedMovie(db)
    db.exec('DELETE FROM tmdb_movies WHERE tmdb_id = 603')
    expect(db.prepare('SELECT tmdb_id FROM videos WHERE id = 10').get()).toEqual({ tmdb_id: null })
  })

  it.each([
    ['videos.match_status', `UPDATE videos SET match_status = 'bogus' WHERE id = 10`],
    [
      'images.source',
      `INSERT INTO images (key, file, source, created_at) VALUES ('k', 'x', 'web', 0)`
    ],
    [
      'credits.role',
      `INSERT INTO people (id, name) VALUES (1, 'A');
       INSERT INTO credits (tmdb_id, person_id, role) VALUES (603, 1, 'writer')`
    ]
  ])('rejects an invalid %s', (_name, sql) => {
    const db = openDb(':memory:')
    seedMovie(db)
    expect(() => db.exec(sql)).toThrow(/CHECK constraint failed/)
  })
})

describe('tx', () => {
  it('commits when the function returns', () => {
    const db = openDb(':memory:')
    const result = tx(db, () => {
      db.exec(`INSERT INTO settings (key, value) VALUES ('a', '1')`)
      return 'ok'
    })
    expect(result).toBe('ok')
    expect(count(db, 'settings')).toBe(1)
  })

  it('rolls back and rethrows when the function throws', () => {
    const db = openDb(':memory:')
    expect(() =>
      tx(db, () => {
        db.exec(`INSERT INTO settings (key, value) VALUES ('a', '1')`)
        throw new Error('boom')
      })
    ).toThrow('boom')
    expect(count(db, 'settings')).toBe(0)
  })
})

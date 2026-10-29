import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { throwAppError } from '@shared/appError'
import { openDb, type Db } from '../../src/main/db'
import { createImageCache } from '../../src/main/images/cache'
import { createLimiter, type Limiter } from '../../src/main/library/queue'
import { createTmdbClient, type TmdbClient } from '../../src/main/metadata/tmdbClient'

const FIXTURES = join(__dirname, '..', 'fixtures', 'tmdb')
let db: Db
let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vp-img-'))
  db = openDb(':memory:')
  db.exec(`
    INSERT INTO library_folders (id, path, added_at) VALUES (1, 'D:/L', 0);
    INSERT INTO tmdb_movies (tmdb_id, title, poster_path, backdrop_path, fetched_at) VALUES (603, 'The Matrix', '/m.jpg', '/mb.jpg', 0);
    INSERT INTO tmdb_shows (tmdb_id, name, poster_path, fetched_at) VALUES (1396, 'Breaking Bad', '/bb.jpg', 0);
    INSERT INTO tmdb_episodes (show_tmdb_id, season, episode, still_path) VALUES (1396, 1, 1, '/still.jpg');
    INSERT INTO videos (id, folder_id, path, size_bytes, mtime_ms, wall_key, parsed_title, tmdb_id, duration_s, added_at)
      VALUES (1, 1, 'D:/L/matrix.mkv', 1, 0, 0, 'The Matrix', 603, 100, 0);
    INSERT INTO videos (id, folder_id, path, size_bytes, mtime_ms, wall_key, parsed_title, duration_s, quick_hash, added_at)
      VALUES (2, 1, 'D:/L/home.avi', 1, 0, 0, 'Home', 200, 'hash-home', 0);
    INSERT INTO videos (id, folder_id, path, size_bytes, mtime_ms, wall_key, parsed_title, kind, show_tmdb_id, season, episode, added_at)
      VALUES (3, 1, 'D:/L/bb.mkv', 1, 0, 0, 'Breaking Bad', 'episode', 1396, 1, 1, 0);
  `)
})
afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

function setup(
  client: TmdbClient = createTmdbClient({ credential: () => 'k', mode: 'fixtures', fixturesDir: FIXTURES }),
  downloadLimit: Limiter = (fn) => fn()
) {
  const toWebp = vi.fn(async (_input: string, output: string, _width: number) => writeFileSync(output, 'webp'))
  const grabFrame = vi.fn(async (_input: string, _at: number, output: string, _width: number) => writeFileSync(output, 'webp'))
  const cache = createImageCache({ db, dir, client, toWebp, grabFrame, limit: (fn) => fn(), downloadLimit, now: () => 7 })
  return { cache, toWebp, grabFrame }
}

describe('image cache', () => {
  it('converts a TMDB poster once, at 400 px, and records it', async () => {
    const { cache, toWebp } = setup()
    const file = await cache.resolve({ type: 'poster', owner: 'video', id: 1 })
    expect(file && existsSync(file)).toBe(true)
    expect(toWebp.mock.calls[0]?.[2]).toBe(400)
    expect(db.prepare('SELECT source, created_at FROM images WHERE key = ?').get('tmdb:w500/m.jpg')).toEqual({
      source: 'tmdb',
      created_at: 7
    })
    expect(await cache.resolve({ type: 'poster', owner: 'video', id: 1 })).toBe(file)
    expect(toWebp).toHaveBeenCalledOnce()
  })

  it('falls back to a frame at 10 % for an unmatched movie, keyed by content', async () => {
    const { cache, grabFrame } = setup()
    expect(await cache.resolve({ type: 'poster', owner: 'video', id: 2 })).not.toBeNull()
    expect(grabFrame.mock.calls[0]?.[0]).toBe('D:/L/home.avi')
    expect(grabFrame.mock.calls[0]?.[1]).toBe(20)
    expect(grabFrame.mock.calls[0]?.[3]).toBe(400)
    expect(db.prepare(`SELECT source FROM images WHERE key = 'frame:hash-home'`).get()).toEqual({ source: 'ffmpeg' })
  })

  it('grabs a new frame when a video id is reused for a different file', async () => {
    const { cache, grabFrame } = setup()
    await cache.resolve({ type: 'poster', owner: 'video', id: 2 })
    db.exec(`DELETE FROM videos WHERE id = 2;
      INSERT INTO videos (id, folder_id, path, size_bytes, mtime_ms, wall_key, parsed_title, duration_s, quick_hash, added_at)
        VALUES (2, 1, 'D:/L/other.avi', 1, 0, 0, 'Other', 50, 'hash-other', 0);`)
    await cache.resolve({ type: 'poster', owner: 'video', id: 2 })
    expect(grabFrame.mock.calls.map((c) => c[0])).toEqual(['D:/L/home.avi', 'D:/L/other.avi'])
  })

  it('downloads at most the given number of TMDB images at once', async () => {
    let active = 0
    let peak = 0
    const slow: TmdbClient = {
      get: async () => ({}) as never,
      image: async (_s, _p, dest) => {
        active++
        peak = Math.max(peak, active)
        await new Promise((r) => setTimeout(r, 5))
        writeFileSync(dest, 'img')
        active--
      }
    }
    db.exec(`INSERT INTO tmdb_shows (tmdb_id, name, poster_path, backdrop_path, logo_path, fetched_at) VALUES (2, 'B', '/a.jpg', '/b.jpg', '/c.png', 0)`)
    const { cache } = setup(slow, createLimiter(1))
    await cache.prefetch([
      { type: 'poster', owner: 'show', id: 2 },
      { type: 'backdrop', owner: 'show', id: 2 },
      { type: 'logo', owner: 'show', id: 2 },
      { type: 'poster', owner: 'show', id: 1396 }
    ])
    expect(peak).toBe(1)
  })

  it('serves show posters, episode stills and 1280 px backdrops', async () => {
    const { cache, toWebp } = setup()
    expect(await cache.resolve({ type: 'poster', owner: 'show', id: 1396 })).not.toBeNull()
    expect(await cache.resolve({ type: 'still', owner: 'video', id: 3 })).not.toBeNull()
    expect(await cache.resolve({ type: 'backdrop', owner: 'video', id: 1 })).not.toBeNull()
    expect(toWebp.mock.calls.map((c) => c[2])).toEqual([400, 400, 1280])
    expect(db.prepare(`SELECT key FROM images ORDER BY key`).all().map((r) => (r as { key: string }).key)).toEqual([
      'tmdb:w1280/mb.jpg',
      'tmdb:w300/still.jpg',
      'tmdb:w500/bb.jpg'
    ])
  })

  it('converts once when the same image is asked for twice at once', async () => {
    const { cache, toWebp } = setup()
    const ref = { type: 'poster', owner: 'video', id: 1 } as const
    const [a, b] = await Promise.all([cache.resolve(ref), cache.resolve(ref)])
    expect(a).toBe(b)
    expect(toWebp).toHaveBeenCalledOnce()
  })

  it('returns null when there is nothing to show or the download fails', async () => {
    expect(await setup().cache.resolve({ type: 'logo', owner: 'video', id: 1 })).toBeNull()
    expect(await setup().cache.resolve({ type: 'poster', owner: 'video', id: 99 })).toBeNull()
    const failing: TmdbClient = { get: async () => ({}) as never, image: async () => throwAppError('tmdb_unavailable') }
    expect(await setup(failing).cache.resolve({ type: 'poster', owner: 'show', id: 1396 })).toBeNull()
    expect(db.prepare('SELECT count(*) AS n FROM images').get()).toEqual({ n: 0 })
  })
})

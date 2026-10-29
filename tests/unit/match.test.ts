import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { throwAppError } from '@shared/appError'
import { openDb, type Db } from '../../src/main/db'
import { matchPending } from '../../src/main/metadata/match'
import { createTmdbClient, type TmdbClient } from '../../src/main/metadata/tmdbClient'

const FIXTURES = join(__dirname, '..', 'fixtures', 'tmdb')
let db: Db
let nextId = 1

function addMovie(title: string, year: number | null) {
  const id = nextId++
  db.prepare(
    `INSERT INTO videos (id, folder_id, path, size_bytes, mtime_ms, wall_key, parsed_title, parsed_year, added_at)
     VALUES (?, 1, ?, 1, 0, 0, ?, ?, 0)`
  ).run(id, `D:/L/${id}.mkv`, title, year)
  return id
}

function addEpisode(show: string, season: number, episode: number) {
  const id = nextId++
  db.prepare(
    `INSERT INTO videos (id, folder_id, path, size_bytes, mtime_ms, wall_key, parsed_title, kind, parsed_show,
       season, episode, added_at)
     VALUES (?, 1, ?, 1, 0, 0, ?, 'episode', ?, ?, ?, 0)`
  ).run(id, `D:/L/${id}.mkv`, show, show.toLowerCase(), season, episode)
  return id
}

const fixtures = () => createTmdbClient({ credential: () => 'k', mode: 'fixtures', fixturesDir: FIXTURES })
const opts = { now: () => 5000, limit: <T>(fn: () => Promise<T>) => fn() }
const video = (id: number) => db.prepare('SELECT * FROM videos WHERE id = ?').get(id) as Record<string, unknown>

beforeEach(() => {
  db = openDb(':memory:')
  db.exec(`INSERT INTO library_folders (id, path, added_at) VALUES (1, 'D:/L', 0)`)
  nextId = 1
})

describe('matchPending — movies', () => {
  it('matches movies and stores their details, genres and credits', async () => {
    const matrix = addMovie('The Matrix', 1999)
    const amelie = addMovie('Amélie', 2001)
    const inception = addMovie('inception', 2010)
    const home = addMovie('Some Unknown Home Video', null)

    const r = await matchPending(db, fixtures(), opts)
    expect(r).toEqual({ matched: 3, unmatched: 1, failed: 0 })
    expect(video(matrix)).toMatchObject({ tmdb_id: 603, match_status: 'matched', match_tried_at: 5000 })
    expect(video(amelie)['tmdb_id']).toBe(194)
    expect(video(inception)['tmdb_id']).toBe(27205)
    expect(video(home)).toMatchObject({ tmdb_id: null, match_status: 'unmatched' })

    expect(db.prepare('SELECT title, year, runtime_min, logo_path FROM tmdb_movies WHERE tmdb_id = 603').get()).toEqual({
      title: 'The Matrix',
      year: 1999,
      runtime_min: 136,
      // TMDB lists an SVG first; PNG is preferred because ffmpeg rasterizes SVG badly.
      logo_path: '/iWxxHjuJ1vCLQcg3iiOMucvbrF1.png'
    })
    const genres = db.prepare('SELECT g.name FROM tmdb_movie_genres mg JOIN genres g ON g.id = mg.genre_id WHERE tmdb_id = 603 ORDER BY g.name').all()
    expect(genres.map((g) => (g as { name: string }).name)).toEqual(['Action', 'Science Fiction'])
    const credits = db
      .prepare(`SELECT p.name, c.role FROM credits c JOIN people p ON p.id = c.person_id WHERE tmdb_id = 603 ORDER BY c.role, c.ord`)
      .all()
      .map((c) => `${(c as { role: string }).role}:${(c as { name: string }).name}`)
    expect(credits).toContain('cast:Keanu Reeves')
    expect(credits).toContain('director:Lana Wachowski')
    expect(credits).not.toContain('director:Joel Silver')
  })

  it('matches two copies of the same film, and a later rematch keeps both', async () => {
    const a = addMovie('The Matrix', 1999)
    const b = addMovie('The Matrix', 1999)
    await matchPending(db, fixtures(), opts)
    expect([video(a)['tmdb_id'], video(b)['tmdb_id']]).toEqual([603, 603])

    // A third copy arriving later must not unlink the first two.
    const c = addMovie('The Matrix', 1999)
    db.exec(`UPDATE videos SET match_status = 'pending' WHERE id = ${b}`)
    await matchPending(db, fixtures(), opts)
    expect([video(a)['tmdb_id'], video(b)['tmdb_id'], video(c)['tmdb_id']]).toEqual([603, 603, 603])
  })

  it('does not fetch a movie that is already cached', async () => {
    db.exec(`INSERT INTO tmdb_movies (tmdb_id, title, fetched_at) VALUES (603, 'The Matrix', 1)`)
    addMovie('The Matrix', 1999)
    const client = fixtures()
    const get = vi.spyOn(client, 'get')
    await matchPending(db, client, opts)
    expect(get.mock.calls.map((c) => c[0])).not.toContain('movie/603')
  })

  it('leaves items pending when TMDB is unreachable', async () => {
    const id = addMovie('The Matrix', 1999)
    const down: TmdbClient = { get: async () => throwAppError('tmdb_unavailable'), image: async () => {} }
    const r = await matchPending(db, down, opts)
    expect(r.failed).toBe(1)
    expect(video(id)).toMatchObject({ match_status: 'pending', match_tried_at: 5000 })
  })
})

describe('matchPending — shows', () => {
  it('groups episodes into one show search and stores seasons and episodes', async () => {
    const ids = [addEpisode('Breaking Bad', 1, 1), addEpisode('Breaking Bad', 1, 2), addEpisode('Breaking Bad', 2, 1)]
    const client = fixtures()
    const get = vi.spyOn(client, 'get')

    const r = await matchPending(db, client, opts)
    expect(r.matched).toBe(3)
    for (const id of ids) expect(video(id)).toMatchObject({ show_tmdb_id: 1396, match_status: 'matched' })
    expect(get.mock.calls.filter((c) => c[0] === 'search/tv')).toHaveLength(1)

    expect(db.prepare('SELECT name, first_air_year FROM tmdb_shows').get()).toEqual({ name: 'Breaking Bad', first_air_year: 2008 })
    expect(db.prepare('SELECT season, name FROM tmdb_seasons ORDER BY season').all().map((s) => ({ ...s }))).toEqual([
      { season: 0, name: 'Specials' },
      { season: 1, name: 'Season 1' },
      { season: 2, name: 'Season 2' },
      { season: 3, name: 'Season 3' },
      { season: 4, name: 'Season 4' },
      { season: 5, name: 'Season 5' }
    ])
    expect(db.prepare('SELECT name, still_path FROM tmdb_episodes WHERE season = 1 AND episode = 2').get()).toEqual({
      name: "Cat's in the Bag...",
      still_path: '/AbMoecO0ZZio0LcgeLxlzdyGs6X.jpg'
    })
    // Only the seasons with local files are fetched.
    expect(db.prepare('SELECT DISTINCT season FROM tmdb_episodes ORDER BY season').all().map((r) => ({ ...r }))).toEqual([
      { season: 1 },
      { season: 2 }
    ])
    expect(get.mock.calls.map((c) => c[0])).not.toContain('tv/1396/season/0')
    expect(
      db.prepare(`SELECT p.name FROM show_credits c JOIN people p ON p.id = c.person_id WHERE role = 'creator'`).get()
    ).toEqual({ name: 'Vince Gilligan' })
  })

  it('marks an unknown show unmatched', async () => {
    const id = addEpisode('Nobody Knows This Show', 1, 1)
    await matchPending(db, fixtures(), opts)
    expect(video(id)).toMatchObject({ show_tmdb_id: null, match_status: 'unmatched' })
  })
})

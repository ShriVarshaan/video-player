import { beforeEach, describe, expect, it } from 'vitest'
import { openDb, type Db } from '../../src/main/db'
import { getShow, getTitle, listFolders, listLibrary, listWall } from '../../src/main/library/queries'
import { wallKey } from '../../src/main/library/scanner'
import { fnv1a32 } from '@shared/hash'

let db: Db

function video(id: number, cols: Record<string, string | number | null>) {
  const base: Record<string, string | number | null> = {
    id,
    folder_id: 1,
    path: `D:/L/${id}.mkv`,
    size_bytes: 100,
    mtime_ms: 0,
    wall_key: 0,
    parsed_title: 'x',
    added_at: 0,
    ...cols
  }
  const keys = Object.keys(base)
  db.prepare(`INSERT INTO videos (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...Object.values(base))
}

beforeEach(() => {
  db = openDb(':memory:')
  db.exec(`
    INSERT INTO library_folders (id, path, added_at, last_scan_at) VALUES (1, 'D:/L', 0, 99), (2, 'E:/Gone', 0, NULL);
    INSERT INTO tmdb_movies (tmdb_id, title, year, fetched_at) VALUES (603, 'The Matrix', 1999, 0);
    INSERT INTO tmdb_shows (tmdb_id, name, first_air_year, overview, fetched_at) VALUES (1396, 'Breaking Bad', 2008, 'Walt.', 0);
    INSERT INTO tmdb_seasons (show_tmdb_id, season, name) VALUES (1396, 1, 'Season 1');
    INSERT INTO tmdb_episodes (show_tmdb_id, season, episode, name) VALUES (1396, 1, 1, 'Pilot'), (1396, 1, 2, 'Cat''s in the Bag...');
  `)
  video(1, { parsed_title: 'The Matrix', tmdb_id: 603, match_status: 'matched', size_bytes: 100 })
  video(2, { parsed_title: 'The Matrix', tmdb_id: 603, match_status: 'matched', size_bytes: 900 })
  video(3, { parsed_title: 'Some Unknown Home Video', match_status: 'unmatched' })
  video(4, { parsed_title: 'Gone Movie', missing_since: 5 })
  for (const [id, s, e] of [[5, 1, 1], [6, 1, 2], [7, 2, 1]] as const) {
    video(id, { kind: 'episode', parsed_title: 'Breaking Bad', parsed_show: 'breaking bad', show_tmdb_id: 1396, season: s, episode: e, duration_s: 3000, match_status: 'matched' })
  }
  video(8, { kind: 'episode', parsed_title: 'My Show', parsed_show: 'my show', season: 1, episode: 1, match_status: 'unmatched' })
})

describe('listLibrary', () => {
  it('lists movies once per film, with TMDB titles and poster URLs', () => {
    const { movies } = listLibrary(db)
    expect(movies).toEqual([
      { videoId: 3, title: 'Some Unknown Home Video', year: null, posterUrl: 'poster://poster/video/3?v=f', matched: false },
      { videoId: 2, title: 'The Matrix', year: 1999, posterUrl: 'poster://poster/video/2?v=t603', matched: true }
    ])
  })

  it('lists shows, including ones TMDB could not match', () => {
    const { shows } = listLibrary(db)
    expect(shows).toEqual([
      { key: 'tmdb:1396', name: 'Breaking Bad', year: 2008, posterUrl: 'poster://poster/show/1396?v=t1396', episodeCount: 3, matched: true },
      { key: 'local:my show', name: 'My Show', year: null, posterUrl: 'poster://poster/video/8?v=f', episodeCount: 1, matched: false }
    ])
  })
})

describe('getShow', () => {
  it('returns seasons, episodes and what to play next', () => {
    db.exec(`INSERT INTO playback_state (video_id, position_s, duration_s, last_played_at) VALUES (5, 1500, 3000, 10)`)
    const show = getShow(db, 'tmdb:1396')!
    expect(show).toMatchObject({ key: 'tmdb:1396', name: 'Breaking Bad', overview: 'Walt.' })
    expect(show.seasons.map((s) => [s.season, s.name, s.episodes.length])).toEqual([
      [1, 'Season 1', 2],
      [2, 'Season 2', 1]
    ])
    expect(show.seasons[0]!.episodes[0]).toEqual({
      season: 1,
      episode: 1,
      title: 'Pilot',
      videoId: 5,
      stillUrl: 'poster://still/video/5?v=t1396',
      positionS: 1500,
      durationS: 3000,
      finished: false
    })
    expect(show.nextUp).toEqual({ action: 'continue', videoId: 5, season: 1, episode: 1, positionS: 1500 })
  })

  it('finds a local show by its parsed name', () => {
    const show = getShow(db, 'local:my show')!
    expect(show.name).toBe('My Show')
    expect(show.seasons[0]!.episodes[0]).toMatchObject({ videoId: 8, title: null })
    expect(show.nextUp).toMatchObject({ action: 'play', videoId: 8 })
  })

  it('follows a local show to its TMDB match once it has been matched', () => {
    const show = getShow(db, 'local:breaking bad')!
    expect(show.key).toBe('tmdb:1396')
    expect(show.name).toBe('Breaking Bad')
  })

  it('returns null for an unknown key', () => {
    expect(getShow(db, 'tmdb:1')).toBeNull()
    expect(getShow(db, 'nope')).toBeNull()
  })
})

describe('listFolders', () => {
  it('reports online state and counts present videos', () => {
    expect(listFolders(db, (p) => p === 'D:/L')).toEqual([
      { id: 1, path: 'D:/L', online: true, videoCount: 7, lastScanAt: 99 },
      { id: 2, path: 'E:/Gone', online: false, videoCount: 0, lastScanAt: null }
    ])
  })
})

describe('listWall', () => {
  beforeEach(() => {
    db.exec(`
      INSERT INTO genres (id, name) VALUES (878, 'Science Fiction'), (18, 'Drama');
      INSERT INTO tmdb_movie_genres (tmdb_id, genre_id) VALUES (603, 878), (603, 18);
      INSERT INTO tmdb_show_genres (show_tmdb_id, genre_id) VALUES (1396, 18);
      UPDATE tmdb_movies SET runtime_min = 136, rating = 8.23, overview = 'Neo.', backdrop_path = '/b.jpg' WHERE tmdb_id = 603;
      UPDATE tmdb_shows SET rating = 8.9, backdrop_path = '/s.jpg' WHERE tmdb_id = 1396;
      UPDATE videos SET wall_key = id * 1000003 % 4294967296;
      UPDATE videos SET duration_s = 5400 WHERE id = 3;
      INSERT INTO playback_state (video_id, position_s, duration_s, last_played_at) VALUES (2, 600, 8160, 10), (6, 100, 3000, 20);
    `)
  })

  const item = (key: string) => listWall(db).find((i) => i.key === key)

  it('returns movies and shows sorted by order', () => {
    const items = listWall(db)
    expect(items.map((i) => i.key).sort()).toEqual(['local:my show', 'movie:2', 'movie:3', 'tmdb:1396'])
    expect(item('movie:2')!.order).toBe(2000006)
    expect(item('tmdb:1396')!.order).toBe(fnv1a32('tmdb:1396'))
    const orders = items.map((i) => i.order)
    expect(orders).toEqual([...orders].sort((a, b) => a - b))
  })

  it('fills movie fields', () => {
    expect(item('movie:2')).toEqual({
      key: 'movie:2',
      kind: 'movie',
      order: 2000006,
      title: 'The Matrix',
      year: 1999,
      posterUrl: 'poster://poster/video/2?v=t603',
      backdropUrl: 'poster://backdrop/video/2?v=t603',
      matched: true,
      runtimeMin: 136,
      seasonCount: null,
      episodeCount: null,
      genres: ['Drama', 'Science Fiction'],
      rating: 8.2,
      overview: 'Neo.',
      progress: 600 / 8160,
      playLabel: 'Continue watching'
    })
  })

  it('falls back for unmatched movies', () => {
    expect(item('movie:3')).toMatchObject({
      title: 'Some Unknown Home Video',
      matched: false,
      backdropUrl: null,
      rating: null,
      genres: [],
      runtimeMin: 90,
      progress: null,
      playLabel: 'Play'
    })
  })

  it('treats a finished movie as not in progress', () => {
    db.exec(`UPDATE playback_state SET position_s = 8000 WHERE video_id = 2`)
    expect(item('movie:2')).toMatchObject({ progress: null, playLabel: 'Play' })
  })

  it('fills show fields', () => {
    expect(item('tmdb:1396')).toMatchObject({
      kind: 'show',
      title: 'Breaking Bad',
      year: 2008,
      seasonCount: 2,
      episodeCount: 3,
      runtimeMin: null,
      genres: ['Drama'],
      rating: 8.9,
      overview: 'Walt.',
      posterUrl: 'poster://poster/show/1396?v=t1396',
      backdropUrl: 'poster://backdrop/show/1396?v=t1396',
      progress: null,
      playLabel: 'Continue watching'
    })
  })

  it('labels a show with nothing started Play episode', () => {
    expect(item('local:my show')).toMatchObject({ playLabel: 'Play episode', backdropUrl: null, matched: false })
  })

  it('excludes missing files and keeps one item per film', () => {
    expect(item('movie:4')).toBeUndefined()
    expect(item('movie:1')).toBeUndefined()
  })

  it('fnv1a32 matches wallKey', () => {
    expect(fnv1a32('abc')).toBe(wallKey('abc'))
  })
})

describe('getTitle', () => {
  beforeEach(() => {
    db.exec(`
      INSERT INTO genres (id, name) VALUES (878, 'Science Fiction'), (18, 'Drama');
      INSERT INTO tmdb_movie_genres (tmdb_id, genre_id) VALUES (603, 878), (603, 18);
      UPDATE tmdb_movies SET runtime_min = 136, rating = 8.23, backdrop_path = '/b.jpg',
        overview = 'Neo is a hacker. He learns the truth. The end.' WHERE tmdb_id = 603;
      UPDATE tmdb_shows SET rating = 8.9 WHERE tmdb_id = 1396;
    `)
  })
  const play = (id: number, pos: number, dur: number, completed = 0, at = 10) =>
    db.prepare('INSERT INTO playback_state (video_id, position_s, duration_s, completed, last_played_at) VALUES (?, ?, ?, ?, ?)').run(id, pos, dur, completed, at)

  it('describes a movie not started', () => {
    expect(getTitle(db, 'movie:2')).toEqual({
      key: 'movie:2',
      kind: 'movie',
      title: 'The Matrix',
      year: 1999,
      runtimeMin: 136,
      seasonCount: null,
      episodeCount: null,
      genres: ['Drama', 'Science Fiction'],
      rating: 8.2,
      overview: 'Neo is a hacker. He learns the truth. The end.',
      posterUrl: 'poster://poster/video/2?v=t603',
      backdropUrl: 'poster://backdrop/video/2?v=t603',
      matched: true,
      watched: false,
      main: { label: 'Play', videoId: 2, from: 'start' },
      restart: null,
      remainingS: null,
      progress: null,
      seasons: [],
      openSeason: null
    })
  })

  it('offers Continue watching and Restart for a movie partway through', () => {
    play(2, 600, 8160)
    const t = getTitle(db, 'movie:2')!
    expect(t.main).toEqual({ label: 'Continue watching', videoId: 2, from: 'resume' })
    expect(t.restart).toEqual({ label: 'Restart', videoId: 2, from: 'start' })
    expect(t.remainingS).toBe(7560)
    expect(t.progress).toBeCloseTo(600 / 8160)
  })

  it('offers Play from the start for a finished movie and marks it watched', () => {
    play(2, 8000, 8160, 1)
    const t = getTitle(db, 'movie:2')!
    expect(t.main).toEqual({ label: 'Play', videoId: 2, from: 'start' })
    expect(t.restart).toBeNull()
    expect(t.watched).toBe(true)
    expect(t.remainingS).toBeNull()
  })

  it('leaves out what an unmatched movie lacks', () => {
    expect(getTitle(db, 'movie:3')).toMatchObject({ title: 'Some Unknown Home Video', overview: null, rating: null, matched: false, genres: [] })
  })

  it('describes a show with nothing watched', () => {
    const t = getTitle(db, 'tmdb:1396')!
    expect(t).toMatchObject({ kind: 'show', title: 'Breaking Bad', seasonCount: 2, episodeCount: 3, rating: 8.9, overview: 'Walt.' })
    expect(t.main).toEqual({ label: 'Play S1 E1', videoId: 5, from: 'start' })
    expect(t.restart).toBeNull()
    expect(t.seasons.map((s) => s.season)).toEqual([1, 2])
    expect(t.openSeason).toBe(1)
  })

  it('continues a show partway through an episode', () => {
    play(6, 1000, 3000)
    const t = getTitle(db, 'tmdb:1396')!
    expect(t.main).toEqual({ label: 'Continue S1 E2', videoId: 6, from: 'resume' })
    expect(t.restart).toEqual({ label: 'Restart episode', videoId: 6, from: 'start' })
    expect(t.remainingS).toBe(2000)
  })

  it('opens the season of the next episode', () => {
    play(6, 3000, 3000, 1)
    const t = getTitle(db, 'tmdb:1396')!
    expect(t.main).toEqual({ label: 'Play S2 E1', videoId: 7, from: 'start' })
    expect(t.openSeason).toBe(2)
  })

  it('follows a local show key to its match, and returns null for unknown keys', () => {
    expect(getTitle(db, 'local:breaking bad')?.key).toBe('tmdb:1396')
    expect(getTitle(db, 'local:my show')).toMatchObject({ title: 'My Show', matched: false })
    expect(getTitle(db, 'movie:999')).toBeNull()
    expect(getTitle(db, 'nonsense')).toBeNull()
  })
})

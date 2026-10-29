import { beforeEach, describe, expect, it } from 'vitest'
import { openDb, type Db } from '../../src/main/db'
import { getShow, listFolders, listLibrary } from '../../src/main/library/queries'

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
      { videoId: 3, title: 'Some Unknown Home Video', year: null, posterUrl: 'poster://poster/video/3', matched: false },
      { videoId: 2, title: 'The Matrix', year: 1999, posterUrl: 'poster://poster/video/2', matched: true }
    ])
  })

  it('lists shows, including ones TMDB could not match', () => {
    const { shows } = listLibrary(db)
    expect(shows).toEqual([
      { key: 'tmdb:1396', name: 'Breaking Bad', year: 2008, posterUrl: 'poster://poster/show/1396', episodeCount: 3, matched: true },
      { key: 'local:my show', name: 'My Show', year: null, posterUrl: 'poster://poster/video/8', episodeCount: 1, matched: false }
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
      stillUrl: 'poster://still/video/5',
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

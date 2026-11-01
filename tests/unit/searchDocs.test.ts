import { beforeEach, describe, expect, it } from 'vitest'
import { openDb, type Db } from '../../src/main/db'
import { listSearchDocs, listWall } from '../../src/main/library/queries'

let db: Db

function video(id: number, cols: Record<string, string | number | null>) {
  const base: Record<string, string | number | null> = {
    id, folder_id: 1, path: `D:/L/${id}.mkv`, size_bytes: 100, mtime_ms: 0, wall_key: id, parsed_title: 'x', added_at: 0, ...cols
  }
  const keys = Object.keys(base)
  db.prepare(`INSERT INTO videos (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...Object.values(base))
}
function played(videoId: number, positionS: number, durationS: number, at: number, completed = 0) {
  db.prepare('INSERT INTO playback_state (video_id, position_s, duration_s, completed, last_played_at) VALUES (?, ?, ?, ?, ?)').run(videoId, positionS, durationS, completed, at)
}
const doc = (key: string) => listSearchDocs(db).find((d) => d.key === key)!

beforeEach(() => {
  db = openDb(':memory:')
  db.exec(`
    INSERT INTO library_folders (id, path, added_at) VALUES (1, 'D:/L', 0);
    INSERT INTO tmdb_movies (tmdb_id, title, original_title, year, logo_path, fetched_at) VALUES (603, 'The Matrix', 'The Matrix', 1999, '/logo.png', 0);
    INSERT INTO tmdb_shows (tmdb_id, name, original_name, first_air_year, fetched_at) VALUES (1396, 'Breaking Bad', 'Breaking Bad', 2008, 0);
    INSERT INTO people (id, name) VALUES (1, 'Keanu Reeves'), (2, 'Lana Wachowski'), (3, 'Bryan Cranston'), (4, 'Vince Gilligan'),
      (11, 'C1'), (12, 'C2'), (13, 'C3'), (14, 'C4'), (15, 'C5'), (16, 'C6');
    INSERT INTO credits (tmdb_id, person_id, role, ord) VALUES (603, 1, 'cast', 0), (603, 2, 'director', 0),
      (603, 16, 'cast', 6), (603, 11, 'cast', 1), (603, 12, 'cast', 2), (603, 13, 'cast', 3), (603, 14, 'cast', 4), (603, 15, 'cast', 5);
    INSERT INTO show_credits (show_tmdb_id, person_id, role, ord) VALUES (1396, 3, 'cast', 0), (1396, 4, 'creator', 0);
  `)
  video(1, { parsed_title: 'The Matrix', tmdb_id: 603, match_status: 'matched', added_at: 50 })
  video(2, { parsed_title: 'The Matrix', tmdb_id: 603, match_status: 'matched', size_bytes: 900, added_at: 70 })
  video(3, { parsed_title: 'Some Unknown Home Video', match_status: 'unmatched', added_at: 10 })
  for (const [id, s, e] of [[5, 1, 1], [6, 1, 2], [7, 2, 1]] as const) {
    video(id, { kind: 'episode', parsed_title: 'Breaking Bad', parsed_show: 'breaking bad', show_tmdb_id: 1396, season: s, episode: e, duration_s: 3000, match_status: 'matched', added_at: 100 + id })
  }
  video(8, { kind: 'episode', parsed_title: 'My Show', parsed_show: 'my show', season: 1, episode: 1, match_status: 'unmatched', added_at: 5 })
})

describe('listSearchDocs', () => {
  it("has the wall's keys in the wall's order", () => {
    expect(listSearchDocs(db).map((d) => d.key)).toEqual(listWall(db).map((w) => w.key))
  })

  it('movie carries cast, directors, original title and logo', () => {
    const m = doc('movie:2')
    expect(m.cast[0]).toBe('Keanu Reeves')
    expect(m.directors).toEqual(['Lana Wachowski'])
    expect(m.originalTitle).toBe('The Matrix')
    expect(m.logoUrl).toMatch(/^poster:\/\/logo\/video\/2/)
  })

  it('show carries creators as directors', () => {
    const s = doc('tmdb:1396')
    expect(s.directors).toEqual(['Vince Gilligan'])
    expect(s.cast).toContain('Bryan Cranston')
    expect(s.logoUrl).toBeNull()
  })

  it('cast is the top 5 by billing', () => {
    expect(doc('movie:2').cast).toEqual(['Keanu Reeves', 'C1', 'C2', 'C3', 'C4'])
  })

  it('unmatched titles have empty people and genres', () => {
    for (const key of ['movie:3', 'local:my show']) {
      const d = doc(key)
      expect(d.cast).toEqual([])
      expect(d.directors).toEqual([])
      expect(d.genres).toEqual([])
      expect(d.originalTitle).toBeNull()
    }
  })

  it("addedAt and lastPlayedAt are the max over the title's files", () => {
    played(5, 3000, 3000, 400, 1)
    played(6, 10, 3000, 900)
    expect(doc('tmdb:1396').addedAt).toBe(107)
    expect(doc('tmdb:1396').lastPlayedAt).toBe(900)
    expect(doc('movie:2').addedAt).toBe(70)
    expect(doc('movie:3').lastPlayedAt).toBeNull()
  })

  describe('inProgress', () => {
    it('a movie partway through is in progress; a finished one is not', () => {
      played(2, 400, 1000, 10)
      played(3, 970, 1000, 20)
      expect(doc('movie:2').inProgress).toBe(true)
      expect(doc('movie:3').inProgress).toBe(false)
    })

    it('a show with an episode finished and the next not started is in progress', () => {
      played(5, 3000, 3000, 10, 1)
      expect(doc('tmdb:1396').inProgress).toBe(true)
      expect(doc('tmdb:1396').progress).toBeNull()
    })

    it('a show watched to its last episode is not', () => {
      played(5, 3000, 3000, 10, 1)
      played(6, 3000, 3000, 20, 1)
      played(7, 3000, 3000, 30, 1)
      expect(doc('tmdb:1396').inProgress).toBe(false)
    })

    it('a show with nothing played is not', () => {
      expect(doc('tmdb:1396').inProgress).toBe(false)
    })

    it('a half-watched episode puts its progress on the show', () => {
      played(6, 1500, 3000, 10)
      expect(doc('tmdb:1396').inProgress).toBe(true)
      expect(doc('tmdb:1396').progress).toBeCloseTo(0.5)
    })
  })
})

import type { EpisodeItem, LibraryFolder, MovieItem, ShowDetail, ShowItem } from '@shared/library'
import { normalizeTitle } from '@shared/normalize'
import type { Db } from '../db'
import { posterUrl } from '../images/posterUrl'
import { isFinished, nextUp, type ProgressEpisode } from './showProgress'

// The URL changes when a title goes from frame artwork to TMDB artwork, so the
// renderer loads the new image instead of keeping its cached one.
const artVersion = (tmdbId: number | null) => (tmdbId === null ? 'f' : `t${tmdbId}`)

const byTitle = (a: { title?: string; name?: string }, b: { title?: string; name?: string }) =>
  normalizeTitle(a.title ?? a.name ?? '').localeCompare(normalizeTitle(b.title ?? b.name ?? ''))

// Keep one row per key: the largest file (the 1080p copy over the 720p one).
function largestPer<T extends { size_bytes: number }>(rows: T[], key: (r: T) => string): T[] {
  const best = new Map<string, T>()
  for (const r of rows) {
    const k = key(r)
    const cur = best.get(k)
    if (!cur || r.size_bytes > cur.size_bytes) best.set(k, r)
  }
  return [...best.values()]
}

type MovieRow = { id: number; parsed_title: string; parsed_year: number | null; tmdb_id: number | null; size_bytes: number; title: string | null; year: number | null }
type EpisodeRow = {
  id: number
  parsed_title: string
  parsed_year: number | null
  parsed_show: string
  show_tmdb_id: number | null
  season: number
  episode: number
  size_bytes: number
  duration_s: number | null
  name: string | null
  first_air_year: number | null
}

const showKey = (r: Pick<EpisodeRow, 'show_tmdb_id' | 'parsed_show'>) =>
  r.show_tmdb_id !== null ? `tmdb:${r.show_tmdb_id}` : `local:${r.parsed_show}`
const episodeOrder = (a: EpisodeRow, b: EpisodeRow) => a.season - b.season || a.episode - b.episode

function episodeRows(db: Db, where = '', ...params: (string | number)[]): EpisodeRow[] {
  return db
    .prepare(
      `SELECT v.id, v.parsed_title, v.parsed_year, v.parsed_show, v.show_tmdb_id, v.season, v.episode, v.size_bytes,
              v.duration_s, s.name, s.first_air_year
       FROM videos v LEFT JOIN tmdb_shows s ON s.tmdb_id = v.show_tmdb_id
       WHERE v.kind = 'episode' AND v.missing_since IS NULL ${where}`
    )
    .all(...params) as EpisodeRow[]
}

export function listLibrary(db: Db): { movies: MovieItem[]; shows: ShowItem[] } {
  const movieRows = db
    .prepare(
      `SELECT v.id, v.parsed_title, v.parsed_year, v.tmdb_id, v.size_bytes, m.title, m.year
       FROM videos v LEFT JOIN tmdb_movies m ON m.tmdb_id = v.tmdb_id
       WHERE v.kind = 'movie' AND v.missing_since IS NULL`
    )
    .all() as MovieRow[]
  const movies = largestPer(movieRows, (r) => (r.tmdb_id !== null ? `tmdb:${r.tmdb_id}` : `video:${r.id}`))
    .map((r) => ({
      videoId: r.id,
      title: r.title ?? r.parsed_title,
      year: r.year ?? r.parsed_year,
      posterUrl: posterUrl({ type: 'poster', owner: 'video', id: r.id }, artVersion(r.tmdb_id)),
      matched: r.tmdb_id !== null
    }))
    .sort(byTitle)

  const groups = new Map<string, EpisodeRow[]>()
  for (const r of episodeRows(db)) groups.set(showKey(r), [...(groups.get(showKey(r)) ?? []), r])
  const shows = [...groups.entries()]
    .map(([key, rows]) => {
      const episodes = largestPer(rows, (r) => `${r.season}x${r.episode}`).sort(episodeOrder)
      const first = episodes[0]!
      const matched = first.show_tmdb_id !== null
      return {
        key,
        name: first.name ?? first.parsed_title,
        year: first.first_air_year ?? first.parsed_year,
        posterUrl: matched
          ? posterUrl({ type: 'poster', owner: 'show', id: first.show_tmdb_id! }, artVersion(first.show_tmdb_id))
          : posterUrl({ type: 'poster', owner: 'video', id: first.id }, artVersion(null)),
        episodeCount: episodes.length,
        matched
      }
    })
    .sort(byTitle)

  return { movies, shows }
}

export function getShow(db: Db, key: string): ShowDetail | null {
  const m = /^(tmdb|local):(.+)$/.exec(key)
  if (!m) return null
  const rows =
    m[1] === 'tmdb'
      ? episodeRows(db, 'AND v.show_tmdb_id = ?', Number(m[2]))
      : episodeRows(db, 'AND v.show_tmdb_id IS NULL AND v.parsed_show = ?', m[2]!)
  if (rows.length === 0) {
    // A show opened before TMDB matched it: follow its episodes to the match.
    if (m[1] === 'local') {
      const matched = db
        .prepare(`SELECT show_tmdb_id FROM videos WHERE kind = 'episode' AND parsed_show = ? AND show_tmdb_id IS NOT NULL LIMIT 1`)
        .get(m[2]!) as { show_tmdb_id: number } | undefined
      if (matched) return getShow(db, `tmdb:${matched.show_tmdb_id}`)
    }
    return null
  }

  const episodes = largestPer(rows, (r) => `${r.season}x${r.episode}`).sort(episodeOrder)
  const first = episodes[0]!
  const showId = first.show_tmdb_id
  const show = showId !== null
    ? (db.prepare('SELECT overview FROM tmdb_shows WHERE tmdb_id = ?').get(showId) as { overview: string | null })
    : null
  const seasonName = db.prepare('SELECT name FROM tmdb_seasons WHERE show_tmdb_id = ? AND season = ?')
  const episodeName = db.prepare('SELECT name FROM tmdb_episodes WHERE show_tmdb_id = ? AND season = ? AND episode = ?')
  const playback = db.prepare('SELECT position_s, duration_s, completed, last_played_at FROM playback_state WHERE video_id = ?')

  const progress: ProgressEpisode[] = []
  const seasons = new Map<number, EpisodeItem[]>()
  for (const r of episodes) {
    const p = playback.get(r.id) as { position_s: number; duration_s: number | null; completed: number; last_played_at: number } | undefined
    const pe: ProgressEpisode = {
      videoId: r.id,
      season: r.season,
      episode: r.episode,
      positionS: p?.position_s ?? 0,
      durationS: p?.duration_s ?? r.duration_s,
      completed: p?.completed === 1,
      lastPlayedAt: p?.last_played_at ?? null
    }
    progress.push(pe)
    const title = showId !== null ? ((episodeName.get(showId, r.season, r.episode) as { name: string | null } | undefined)?.name ?? null) : null
    seasons.set(r.season, [
      ...(seasons.get(r.season) ?? []),
      {
        season: r.season,
        episode: r.episode,
        title,
        videoId: r.id,
        stillUrl: posterUrl({ type: 'still', owner: 'video', id: r.id }, artVersion(showId)),
        positionS: pe.positionS,
        durationS: pe.durationS,
        finished: isFinished(pe)
      }
    ])
  }

  return {
    key,
    name: first.name ?? first.parsed_title,
    overview: show?.overview ?? null,
    seasons: [...seasons.entries()].map(([season, eps]) => ({
      season,
      name:
        (showId !== null ? (seasonName.get(showId, season) as { name: string | null } | undefined)?.name : null) ??
        (season === 0 ? 'Specials' : `Season ${season}`),
      episodes: eps
    })),
    nextUp: nextUp(progress)
  }
}

export function listFolders(db: Db, exists: (p: string) => boolean): LibraryFolder[] {
  const rows = db
    .prepare(
      `SELECT f.id, f.path, f.last_scan_at,
              (SELECT count(*) FROM videos v WHERE v.folder_id = f.id AND v.missing_since IS NULL) AS n
       FROM library_folders f ORDER BY f.id`
    )
    .all() as { id: number; path: string; last_scan_at: number | null; n: number }[]
  return rows.map((r) => ({ id: r.id, path: r.path, online: exists(r.path), videoCount: Number(r.n), lastScanAt: r.last_scan_at }))
}

import { fnv1a32 } from '@shared/hash'
import type { EpisodeItem, LibraryFolder, MovieItem, NextUp, SearchDoc, ShowDetail, ShowItem, TitleDetail, WallItem } from '@shared/library'
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

type WallMovieRow = MovieRow & {
  duration_s: number | null
  runtime_min: number | null
  rating: number | null
  overview: string | null
  backdrop_path: string | null
  position_s: number | null
  pb_duration_s: number | null
  completed: number | null
}
type PlaybackRow = { position_s: number; duration_s: number | null; completed: number; last_played_at: number }

const oneDecimal = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10)

function genresBy(db: Db, table: 'tmdb_movie_genres' | 'tmdb_show_genres', idCol: string): Map<number, string[]> {
  const rows = db
    .prepare(`SELECT t.${idCol} AS id, g.name FROM ${table} t JOIN genres g ON g.id = t.genre_id ORDER BY g.name`)
    .all() as { id: number; name: string }[]
  const out = new Map<number, string[]>()
  for (const r of rows) out.set(r.id, [...(out.get(r.id) ?? []), r.name])
  return out
}

// One entry per show on disk: its episodes (largest file per episode, in order)
// with their playback, and the show page's main button.
type ShowGroup = { key: string; episodes: EpisodeRow[]; progress: ProgressEpisode[]; up: NextUp | null }

function showGroups(db: Db): ShowGroup[] {
  const playback = db.prepare('SELECT position_s, duration_s, completed, last_played_at FROM playback_state WHERE video_id = ?')
  const groups = new Map<string, EpisodeRow[]>()
  for (const r of episodeRows(db)) groups.set(showKey(r), [...(groups.get(showKey(r)) ?? []), r])
  return [...groups.entries()].map(([key, rows]) => {
    const episodes = largestPer(rows, (r) => `${r.season}x${r.episode}`).sort(episodeOrder)
    const progress = episodes.map((r): ProgressEpisode => {
      const p = playback.get(r.id) as PlaybackRow | undefined
      return {
        videoId: r.id,
        season: r.season,
        episode: r.episode,
        positionS: p?.position_s ?? 0,
        durationS: p?.duration_s ?? r.duration_s,
        completed: p?.completed === 1,
        lastPlayedAt: p?.last_played_at ?? null
      }
    })
    return { key, episodes, progress, up: nextUp(progress) }
  })
}

// Everything the home wall draws, one item per movie and per show, in wall order.
export function listWall(db: Db): WallItem[] {
  const movieGenres = genresBy(db, 'tmdb_movie_genres', 'tmdb_id')
  const showGenres = genresBy(db, 'tmdb_show_genres', 'show_tmdb_id')

  const movieRows = db
    .prepare(
      `SELECT v.id, v.parsed_title, v.parsed_year, v.tmdb_id, v.size_bytes, v.duration_s, v.wall_key,
              m.title, m.year, m.runtime_min, m.rating, m.overview, m.backdrop_path,
              p.position_s, p.duration_s AS pb_duration_s, p.completed
       FROM videos v
       LEFT JOIN tmdb_movies m ON m.tmdb_id = v.tmdb_id
       LEFT JOIN playback_state p ON p.video_id = v.id
       WHERE v.kind = 'movie' AND v.missing_since IS NULL`
    )
    .all() as (WallMovieRow & { wall_key: number })[]
  const movies = largestPer(movieRows, (r) => (r.tmdb_id !== null ? `tmdb:${r.tmdb_id}` : `video:${r.id}`)).map(
    (r): WallItem => {
      const art = artVersion(r.tmdb_id)
      const pb = { positionS: r.position_s ?? 0, durationS: r.pb_duration_s ?? r.duration_s, completed: r.completed === 1 }
      const started = pb.positionS > 0 && pb.durationS !== null && pb.durationS > 0 && !isFinished(pb)
      return {
        key: `movie:${r.id}`,
        kind: 'movie',
        order: Number(r.wall_key),
        title: r.title ?? r.parsed_title,
        year: r.year ?? r.parsed_year,
        posterUrl: posterUrl({ type: 'poster', owner: 'video', id: r.id }, art),
        backdropUrl: r.backdrop_path ? posterUrl({ type: 'backdrop', owner: 'video', id: r.id }, art) : null,
        matched: r.tmdb_id !== null,
        runtimeMin: r.runtime_min ?? (r.duration_s ? Math.round(r.duration_s / 60) : null),
        seasonCount: null,
        episodeCount: null,
        genres: r.tmdb_id !== null ? (movieGenres.get(r.tmdb_id) ?? []) : [],
        rating: oneDecimal(r.rating),
        overview: r.overview,
        progress: started ? pb.positionS / pb.durationS! : null,
        playLabel: started ? 'Continue watching' : 'Play'
      }
    }
  )

  const showInfo = db.prepare('SELECT rating, overview, backdrop_path FROM tmdb_shows WHERE tmdb_id = ?')
  const shows = showGroups(db).map(({ key, episodes, up }): WallItem => {
    const first = episodes[0]!
    const id = first.show_tmdb_id
    const info = id !== null ? (showInfo.get(id) as { rating: number | null; overview: string | null; backdrop_path: string | null } | undefined) : undefined
    return {
      key,
      kind: 'show',
      order: fnv1a32(key),
      title: first.name ?? first.parsed_title,
      year: first.first_air_year ?? first.parsed_year,
      posterUrl:
        id !== null
          ? posterUrl({ type: 'poster', owner: 'show', id }, artVersion(id))
          : posterUrl({ type: 'poster', owner: 'video', id: first.id }, artVersion(null)),
      backdropUrl: info?.backdrop_path ? posterUrl({ type: 'backdrop', owner: 'show', id: id! }, artVersion(id)) : null,
      matched: id !== null,
      runtimeMin: null,
      seasonCount: new Set(episodes.filter((e) => e.season >= 1).map((e) => e.season)).size,
      episodeCount: episodes.length,
      genres: id !== null ? (showGenres.get(id) ?? []) : [],
      rating: oneDecimal(info?.rating ?? null),
      overview: info?.overview ?? null,
      progress: null,
      playLabel: up?.action === 'continue' ? 'Continue watching' : 'Play episode'
    }
  })

  return [...movies, ...shows].sort((a, b) => a.order - b.order || a.key.localeCompare(b.key))
}

const TOP_CAST = 5

// One search document per wall title (milestone 8): the wall item plus the
// fields search matches on and the empty-state rows sort by.
export function listSearchDocs(db: Db): SearchDoc[] {
  const groups = new Map(showGroups(db).map((g) => [g.key, g]))
  const names = (sql: string) => {
    const q = db.prepare(sql)
    return (id: number) => (q.all(id) as { name: string }[]).map((r) => r.name)
  }
  const movieCast = names(`SELECT p.name FROM credits c JOIN people p ON p.id = c.person_id WHERE c.tmdb_id = ? AND c.role = 'cast' ORDER BY c.ord LIMIT ${TOP_CAST}`)
  const movieDirectors = names(`SELECT p.name FROM credits c JOIN people p ON p.id = c.person_id WHERE c.tmdb_id = ? AND c.role = 'director' ORDER BY c.ord`)
  const showCast = names(`SELECT p.name FROM show_credits c JOIN people p ON p.id = c.person_id WHERE c.show_tmdb_id = ? AND c.role = 'cast' ORDER BY c.ord LIMIT ${TOP_CAST}`)
  const showCreators = names(`SELECT p.name FROM show_credits c JOIN people p ON p.id = c.person_id WHERE c.show_tmdb_id = ? AND c.role = 'creator' ORDER BY c.ord`)
  const movie = db.prepare(
    `SELECT v.tmdb_id, m.original_title, m.logo_path,
            MAX(f.added_at) AS added_at, MAX(p.last_played_at) AS last_played_at
     FROM videos v
     LEFT JOIN tmdb_movies m ON m.tmdb_id = v.tmdb_id
     JOIN videos f ON f.kind = 'movie' AND f.missing_since IS NULL AND (f.id = v.id OR (v.tmdb_id IS NOT NULL AND f.tmdb_id = v.tmdb_id))
     LEFT JOIN playback_state p ON p.video_id = f.id
     WHERE v.id = ?`
  )
  const show = db.prepare('SELECT original_name, logo_path FROM tmdb_shows WHERE tmdb_id = ?')
  const fileDates = db.prepare('SELECT added_at FROM videos WHERE id = ?')

  return listWall(db).map((w): SearchDoc => {
    if (w.kind === 'movie') {
      const id = Number(w.key.slice('movie:'.length))
      const r = movie.get(id) as { tmdb_id: number | null; original_title: string | null; logo_path: string | null; added_at: number; last_played_at: number | null }
      const tmdb = r.tmdb_id
      return {
        ...w,
        originalTitle: r.original_title,
        cast: tmdb !== null ? movieCast(tmdb) : [],
        directors: tmdb !== null ? movieDirectors(tmdb) : [],
        logoUrl: r.logo_path ? posterUrl({ type: 'logo', owner: 'video', id }, artVersion(tmdb)) : null,
        addedAt: r.added_at,
        lastPlayedAt: r.last_played_at,
        inProgress: w.progress !== null
      }
    }
    const g = groups.get(w.key)!
    const tmdb = g.episodes[0]!.show_tmdb_id
    const info = tmdb !== null ? (show.get(tmdb) as { original_name: string | null; logo_path: string | null } | undefined) : undefined
    const played = g.progress.filter((e) => e.lastPlayedAt !== null)
    const half = g.up?.action === 'continue' ? g.progress.find((e) => e.videoId === g.up!.videoId) : undefined
    return {
      ...w,
      originalTitle: info?.original_name ?? null,
      cast: tmdb !== null ? showCast(tmdb) : [],
      directors: tmdb !== null ? showCreators(tmdb) : [],
      logoUrl: info?.logo_path ? posterUrl({ type: 'logo', owner: 'show', id: tmdb! }, artVersion(tmdb)) : null,
      addedAt: Math.max(...g.episodes.map((e) => (fileDates.get(e.id) as { added_at: number }).added_at)),
      lastPlayedAt: played.length ? Math.max(...played.map((e) => e.lastPlayedAt!)) : null,
      inProgress: g.up?.action === 'continue' || played.length > 0,
      progress: half && half.durationS ? half.positionS / half.durationS : null
    }
  })
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

// Everything the title page shows, for a movie ('movie:<videoId>') or a show key.
export function getTitle(db: Db, key: string): TitleDetail | null {
  if (key.startsWith('movie:')) return movieTitle(db, key)
  const show = getShow(db, key)
  if (!show) return null
  const item = listWall(db).find((i) => i.key === show.key)
  if (!item) return null
  const episodes = show.seasons.flatMap((s) => s.episodes)
  const up = show.nextUp!
  const ep = episodes.find((e) => e.videoId === up.videoId)!
  const continuing = up.action === 'continue'
  const sxe = `S${up.season} E${up.episode}`
  return {
    ...common(item),
    watched: false,
    main: { label: continuing ? `Continue ${sxe}` : `Play ${sxe}`, videoId: up.videoId, from: continuing ? 'resume' : 'start' },
    restart: continuing ? { label: 'Restart episode', videoId: up.videoId, from: 'start' } : null,
    ...remaining(continuing, up.positionS, ep.durationS),
    seasons: show.seasons,
    openSeason: up.season
  }
}

function movieTitle(db: Db, key: string): TitleDetail | null {
  const item = listWall(db).find((i) => i.key === key)
  if (!item) return null
  const videoId = Number(key.slice('movie:'.length))
  const v = db.prepare('SELECT duration_s FROM videos WHERE id = ?').get(videoId) as { duration_s: number | null }
  const p = db.prepare('SELECT position_s, duration_s, completed FROM playback_state WHERE video_id = ?').get(videoId) as
    | { position_s: number; duration_s: number | null; completed: number }
    | undefined
  const pb = { positionS: p?.position_s ?? 0, durationS: p?.duration_s ?? v.duration_s, completed: p?.completed === 1 }
  const watched = p !== undefined && isFinished(pb)
  const continuing = !watched && pb.positionS > 0
  return {
    ...common(item),
    watched,
    main: { label: continuing ? 'Continue watching' : 'Play', videoId, from: continuing ? 'resume' : 'start' },
    restart: continuing ? { label: 'Restart', videoId, from: 'start' } : null,
    ...remaining(continuing, pb.positionS, pb.durationS),
    seasons: [],
    openSeason: null
  }
}

function common(item: WallItem) {
  const { key, kind, title, year, runtimeMin, seasonCount, episodeCount, genres, rating, overview, posterUrl, backdropUrl, matched } = item
  return { key, kind, title, year, runtimeMin, seasonCount, episodeCount, genres, rating, overview, posterUrl, backdropUrl, matched }
}

function remaining(continuing: boolean, positionS: number, durationS: number | null) {
  if (!continuing || durationS === null || durationS <= 0) return { remainingS: null, progress: null }
  return { remainingS: Math.max(0, durationS - positionS), progress: positionS / durationS }
}

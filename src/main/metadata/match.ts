import { parseAppError } from '@shared/appError'
import { tx, type Db } from '../db'
import { pickBest, type Candidate } from './score'
import type { TmdbClient } from './tmdbClient'
import { rekeyPrefs } from '../player/titlePrefs'

type Opts = {
  now: () => number
  limit: <T>(fn: () => Promise<T>) => Promise<T>
  onProgress?: (done: number, total: number) => void
}

type Result = { matched: number; unmatched: number; failed: number }

type SearchResult = { results: { id: number; title?: string; name?: string; release_date?: string; first_air_date?: string; popularity?: number }[] }
type Person = { id: number; name: string; character?: string; order?: number; job?: string }
type Genre = { id: number; name: string }
type Logos = { images?: { logos?: { file_path: string; iso_639_1: string | null }[] } }
type MovieDetail = Logos & {
  id: number; title: string; original_title?: string; original_language?: string; release_date?: string; overview?: string; runtime?: number
  vote_average?: number; poster_path?: string | null; backdrop_path?: string | null; genres?: Genre[]
  credits?: { cast?: Person[]; crew?: Person[] }
}
type ShowDetail = Logos & {
  id: number; name: string; original_name?: string; original_language?: string; first_air_date?: string; overview?: string; vote_average?: number
  poster_path?: string | null; backdrop_path?: string | null; genres?: Genre[]; created_by?: Person[]
  credits?: { cast?: Person[] }; seasons?: { season_number: number; name?: string; poster_path?: string | null }[]
}
type SeasonDetail = {
  episodes?: { episode_number: number; name?: string; overview?: string; air_date?: string; runtime?: number; still_path?: string | null }[]
}

const DETAIL_PARAMS = { append_to_response: 'credits,images', include_image_language: 'en,null' }
const TOP_CAST = 10

const yearOf = (date?: string) => (date && /^\d{4}/.test(date) ? Number(date.slice(0, 4)) : null)
// English title logo, PNG first: TMDB often lists an SVG first, and ffmpeg
// rasterizes SVG small and blurry. An SVG is used only when there is no PNG.
const logoOf = (d: Logos) => {
  const en = (d.images?.logos ?? []).filter((l) => l.iso_639_1 === 'en')
  return (en.find((l) => l.file_path.toLowerCase().endsWith('.png')) ?? en[0])?.file_path ?? null
}

// A search that TMDB answers with "not found" means no candidates. Anything
// else (offline, bad key, 5xx) is a failure that leaves the item pending.
async function search(client: TmdbClient, path: string, params: Record<string, string | number>): Promise<Candidate[]> {
  try {
    const r = await client.get<SearchResult>(path, params)
    return r.results.map((x) => ({
      id: x.id,
      title: x.title ?? x.name ?? '',
      year: yearOf(x.release_date ?? x.first_air_date),
      popularity: x.popularity ?? 0
    }))
  } catch (e) {
    if (parseAppError(e)?.code === 'tmdb_not_found') return []
    throw e
  }
}

export async function matchPending(db: Db, client: TmdbClient, opts: Opts): Promise<Result> {
  const result: Result = { matched: 0, unmatched: 0, failed: 0 }
  const now = opts.now()

  const upsertPerson = db.prepare('INSERT INTO people (id, name) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name')
  const upsertGenre = db.prepare('INSERT INTO genres (id, name) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name')
  const markTried = db.prepare('UPDATE videos SET match_tried_at = ? WHERE id = ?')
  const setMovie = db.prepare(`UPDATE videos SET tmdb_id = ?, match_status = ?, match_tried_at = ? WHERE id = ?`)
  const setEpisode = db.prepare(`UPDATE videos SET show_tmdb_id = ?, match_status = ?, match_tried_at = ? WHERE id = ?`)

  function saveMovie(d: MovieDetail) {
    // Upsert, never REPLACE: REPLACE deletes the row first, and ON DELETE SET NULL
    // would unlink every video already matched to it.
    db.prepare(
      `INSERT INTO tmdb_movies (tmdb_id, title, original_title, original_language, year, overview, runtime_min, rating,
         poster_path, backdrop_path, logo_path, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(tmdb_id) DO UPDATE SET title = excluded.title, original_title = excluded.original_title,
         original_language = excluded.original_language,
         year = excluded.year, overview = excluded.overview, runtime_min = excluded.runtime_min, rating = excluded.rating,
         poster_path = excluded.poster_path, backdrop_path = excluded.backdrop_path, logo_path = excluded.logo_path,
         fetched_at = excluded.fetched_at`
    ).run(d.id, d.title, d.original_title ?? null, d.original_language ?? null, yearOf(d.release_date), d.overview ?? null,
      d.runtime ?? null, d.vote_average ?? null, d.poster_path ?? null, d.backdrop_path ?? null, logoOf(d), now)
    for (const g of d.genres ?? []) {
      upsertGenre.run(g.id, g.name)
      db.prepare('INSERT OR IGNORE INTO tmdb_movie_genres (tmdb_id, genre_id) VALUES (?, ?)').run(d.id, g.id)
    }
    const addCredit = db.prepare('INSERT OR IGNORE INTO credits (tmdb_id, person_id, role, character, ord) VALUES (?, ?, ?, ?, ?)')
    for (const p of (d.credits?.cast ?? []).slice(0, TOP_CAST)) {
      upsertPerson.run(p.id, p.name)
      addCredit.run(d.id, p.id, 'cast', p.character ?? null, p.order ?? 0)
    }
    ;(d.credits?.crew ?? []).filter((p) => p.job === 'Director').forEach((p, i) => {
      upsertPerson.run(p.id, p.name)
      addCredit.run(d.id, p.id, 'director', null, i)
    })
  }

  function saveShow(d: ShowDetail) {
    db.prepare(
      `INSERT INTO tmdb_shows (tmdb_id, name, original_name, original_language, first_air_year, overview, rating, poster_path,
         backdrop_path, logo_path, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(tmdb_id) DO UPDATE SET name = excluded.name, original_name = excluded.original_name,
         original_language = excluded.original_language,
         first_air_year = excluded.first_air_year, overview = excluded.overview, rating = excluded.rating,
         poster_path = excluded.poster_path, backdrop_path = excluded.backdrop_path, logo_path = excluded.logo_path,
         fetched_at = excluded.fetched_at`
    ).run(d.id, d.name, d.original_name ?? null, d.original_language ?? null, yearOf(d.first_air_date), d.overview ?? null,
      d.vote_average ?? null, d.poster_path ?? null, d.backdrop_path ?? null, logoOf(d), now)
    for (const s of d.seasons ?? []) {
      db.prepare('INSERT OR REPLACE INTO tmdb_seasons (show_tmdb_id, season, name, poster_path) VALUES (?, ?, ?, ?)')
        .run(d.id, s.season_number, s.name ?? null, s.poster_path ?? null)
    }
    for (const g of d.genres ?? []) {
      upsertGenre.run(g.id, g.name)
      db.prepare('INSERT OR IGNORE INTO tmdb_show_genres (show_tmdb_id, genre_id) VALUES (?, ?)').run(d.id, g.id)
    }
    const addCredit = db.prepare(
      'INSERT OR IGNORE INTO show_credits (show_tmdb_id, person_id, role, character, ord) VALUES (?, ?, ?, ?, ?)'
    )
    for (const p of (d.credits?.cast ?? []).slice(0, TOP_CAST)) {
      upsertPerson.run(p.id, p.name)
      addCredit.run(d.id, p.id, 'cast', p.character ?? null, p.order ?? 0)
    }
    ;(d.created_by ?? []).forEach((p, i) => {
      upsertPerson.run(p.id, p.name)
      addCredit.run(d.id, p.id, 'creator', null, i)
    })
  }

  function saveSeason(showId: number, season: number, d: SeasonDetail) {
    const insert = db.prepare(
      `INSERT OR REPLACE INTO tmdb_episodes (show_tmdb_id, season, episode, name, overview, air_date, runtime_min, still_path)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const e of d.episodes ?? []) {
      insert.run(showId, season, e.episode_number, e.name ?? null, e.overview ?? null, e.air_date ?? null,
        e.runtime ?? null, e.still_path ?? null)
    }
  }

  const movies = db
    .prepare(`SELECT id, parsed_title, parsed_year FROM videos
              WHERE kind = 'movie' AND match_status = 'pending' AND missing_since IS NULL`)
    .all() as { id: number; parsed_title: string; parsed_year: number | null }[]

  const episodes = db
    .prepare(`SELECT id, parsed_title, parsed_year, parsed_show, season FROM videos
              WHERE kind = 'episode' AND match_status = 'pending' AND missing_since IS NULL`)
    .all() as { id: number; parsed_title: string; parsed_year: number | null; parsed_show: string; season: number }[]
  const groups = new Map<string, typeof episodes>()
  for (const e of episodes) {
    const key = `${e.parsed_show}|${e.parsed_year ?? ''}`
    groups.set(key, [...(groups.get(key) ?? []), e])
  }

  const total = movies.length + groups.size
  let done = 0
  const tick = () => opts.onProgress?.(++done, total)
  const failed = (ids: number[]) => {
    result.failed += ids.length
    tx(db, () => ids.forEach((id) => markTried.run(now, id)))
  }

  await Promise.all([
    ...movies.map((m) =>
      opts.limit(async () => {
        try {
          let candidates = await search(client, 'search/movie', m.parsed_year ? { query: m.parsed_title, year: m.parsed_year } : { query: m.parsed_title })
          let best = pickBest({ title: m.parsed_title, year: m.parsed_year }, candidates)
          if (!best && m.parsed_year) {
            candidates = await search(client, 'search/movie', { query: m.parsed_title })
            best = pickBest({ title: m.parsed_title, year: m.parsed_year }, candidates)
          }
          if (!best) {
            setMovie.run(null, 'unmatched', now, m.id)
            result.unmatched++
            return
          }
          const cached = db.prepare('SELECT 1 FROM tmdb_movies WHERE tmdb_id = ?').get(best.id)
          const detail = cached ? null : await client.get<MovieDetail>(`movie/${best.id}`, DETAIL_PARAMS)
          tx(db, () => {
            if (detail) saveMovie(detail)
            setMovie.run(best.id, 'matched', now, m.id)
          })
          result.matched++
        } catch {
          failed([m.id])
        } finally {
          tick()
        }
      })
    ),
    ...[...groups.values()].map((rows) =>
      opts.limit(async () => {
        const first = rows[0]!
        const ids = rows.map((r) => r.id)
        try {
          const params: Record<string, string | number> = { query: first.parsed_title }
          if (first.parsed_year) params['first_air_date_year'] = first.parsed_year
          const best = pickBest({ title: first.parsed_title, year: first.parsed_year }, await search(client, 'search/tv', params))
          if (!best) {
            tx(db, () => ids.forEach((id) => setEpisode.run(null, 'unmatched', now, id)))
            result.unmatched += ids.length
            return
          }
          const cached = db.prepare('SELECT 1 FROM tmdb_shows WHERE tmdb_id = ?').get(best.id)
          const detail = cached ? null : await client.get<ShowDetail>(`tv/${best.id}`, DETAIL_PARAMS)
          // Only seasons we have files for, and only ones not fetched before.
          const seasons = [...new Set(rows.map((r) => r.season))].filter(
            (s) => !db.prepare('SELECT 1 FROM tmdb_episodes WHERE show_tmdb_id = ? AND season = ?').get(best.id, s)
          )
          const seasonDetails = await Promise.all(
            seasons.map(async (s) => {
              try {
                return [s, await client.get<SeasonDetail>(`tv/${best.id}/season/${s}`)] as const
              } catch (e) {
                if (parseAppError(e)?.code === 'tmdb_not_found') return [s, {}] as const
                throw e
              }
            })
          )
          tx(db, () => {
            if (detail) saveShow(detail)
            for (const [s, d] of seasonDetails) saveSeason(best.id, s, d)
            ids.forEach((id) => setEpisode.run(best.id, 'matched', now, id))
            // The show's key changes from local:<name> to tmdb:<id>; keep what the player remembered.
            if (first.parsed_show) rekeyPrefs(db, `local:${first.parsed_show}`, `tmdb:${best.id}`)
          })
          result.matched += ids.length
        } catch {
          failed(ids)
        } finally {
          tick()
        }
      })
    )
  ])
  return result
}

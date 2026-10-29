import { createHash } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { extname, join } from 'node:path'
import type { Db } from '../db'
import type { TmdbClient } from '../metadata/tmdbClient'
import type { PosterRef } from './posterUrl'

export type ImageCache = {
  resolve(ref: PosterRef): Promise<string | null>
  prefetch(refs: PosterRef[]): Promise<void>
}

type Options = {
  db: Db
  dir: string
  client: TmdbClient
  toWebp: (input: string, output: string, width: number) => Promise<void>
  grabFrame: (input: string, atS: number, output: string, width: number) => Promise<void>
  limit: <T>(fn: () => Promise<T>) => Promise<T>
  now: () => number
}

// TMDB download size and the width we keep, per image type.
const SIZES: Record<PosterRef['type'], { size: string; width: number }> = {
  poster: { size: 'w500', width: 400 },
  still: { size: 'w300', width: 400 },
  backdrop: { size: 'w1280', width: 1280 },
  logo: { size: 'w500', width: 500 }
}
const FRAME_WIDTH = 400

type Source = { kind: 'tmdb'; path: string } | { kind: 'frame'; videoId: number; file: string; durationS: number | null }

type VideoRow = {
  id: number
  path: string
  duration_s: number | null
  kind: string
  m_poster: string | null
  m_backdrop: string | null
  m_logo: string | null
  s_poster: string | null
  s_backdrop: string | null
  s_logo: string | null
  still: string | null
}

export function createImageCache(opts: Options): ImageCache {
  const { db } = opts
  mkdirSync(opts.dir, { recursive: true })
  const inFlight = new Map<string, Promise<string | null>>()

  const videoQuery = db.prepare(`
    SELECT v.id, v.path, v.duration_s, v.kind,
           m.poster_path AS m_poster, m.backdrop_path AS m_backdrop, m.logo_path AS m_logo,
           s.poster_path AS s_poster, s.backdrop_path AS s_backdrop, s.logo_path AS s_logo,
           e.still_path AS still
    FROM videos v
    LEFT JOIN tmdb_movies m ON m.tmdb_id = v.tmdb_id
    LEFT JOIN tmdb_shows s ON s.tmdb_id = v.show_tmdb_id
    LEFT JOIN tmdb_episodes e ON e.show_tmdb_id = v.show_tmdb_id AND e.season = v.season AND e.episode = v.episode
    WHERE v.id = ?`)
  const showQuery = db.prepare('SELECT poster_path, backdrop_path, logo_path FROM tmdb_shows WHERE tmdb_id = ?')
  const imageQuery = db.prepare('SELECT file FROM images WHERE key = ?')
  const insertImage = db.prepare(
    `INSERT INTO images (key, file, width, source, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET file = excluded.file, width = excluded.width, created_at = excluded.created_at`
  )

  function sourceFor(ref: PosterRef): Source | null {
    const tmdb = (path: string | null | undefined): Source | null => (path ? { kind: 'tmdb', path } : null)
    if (ref.owner === 'show') {
      const s = showQuery.get(ref.id) as { poster_path: string | null; backdrop_path: string | null; logo_path: string | null } | undefined
      if (!s) return null
      return ref.type === 'poster' ? tmdb(s.poster_path) : ref.type === 'backdrop' ? tmdb(s.backdrop_path) : ref.type === 'logo' ? tmdb(s.logo_path) : null
    }
    const v = videoQuery.get(ref.id) as VideoRow | undefined
    if (!v) return null
    const frame: Source = { kind: 'frame', videoId: v.id, file: v.path, durationS: v.duration_s }
    const movie = v.kind === 'movie'
    switch (ref.type) {
      case 'poster':
        return tmdb(movie ? v.m_poster : v.s_poster) ?? frame
      case 'still':
        return tmdb(v.still) ?? frame
      case 'backdrop':
        return tmdb(movie ? v.m_backdrop : v.s_backdrop)
      case 'logo':
        return tmdb(movie ? v.m_logo : v.s_logo)
    }
  }

  async function create(key: string, source: Source, type: PosterRef['type']): Promise<string | null> {
    const name = `${createHash('sha1').update(key).digest('hex')}.webp`
    const out = join(opts.dir, name)
    try {
      if (source.kind === 'tmdb') {
        const { size, width } = SIZES[type]
        const download = join(opts.dir, `${name}.src${extname(source.path)}`)
        try {
          await opts.client.image(size, source.path, download)
          await opts.limit(() => opts.toWebp(download, out, width))
        } finally {
          await rm(download, { force: true })
        }
        insertImage.run(key, name, width, 'tmdb', opts.now())
      } else {
        const at = source.durationS ? source.durationS * 0.1 : 0
        await opts.limit(() => opts.grabFrame(source.file, at, out, FRAME_WIDTH))
        insertImage.run(key, name, FRAME_WIDTH, 'ffmpeg', opts.now())
      }
      return out
    } catch {
      await rm(out, { force: true })
      return null
    }
  }

  async function resolve(ref: PosterRef): Promise<string | null> {
    const source = sourceFor(ref)
    if (!source) return null
    const key = source.kind === 'tmdb' ? `tmdb:${SIZES[ref.type].size}${source.path}` : `frame:${source.videoId}`

    const cached = imageQuery.get(key) as { file: string } | undefined
    if (cached && existsSync(join(opts.dir, cached.file))) return join(opts.dir, cached.file)

    let pending = inFlight.get(key)
    if (!pending) {
      pending = create(key, source, ref.type).finally(() => inFlight.delete(key))
      inFlight.set(key, pending)
    }
    return pending
  }

  return {
    resolve,
    async prefetch(refs) {
      await Promise.all(refs.map((r) => resolve(r)))
    }
  }
}

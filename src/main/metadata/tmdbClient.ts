import { copyFile, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { throwAppError } from '@shared/appError'
import { normalizeTitle } from '@shared/normalize'

export type TmdbClient = {
  get<T>(path: string, params?: Record<string, string | number>): Promise<T>
  image(size: string, tmdbPath: string, dest: string): Promise<void>
}

type Options = {
  credential: () => string | null
  mode: 'live' | 'fixtures'
  fixturesDir: string
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
}

const API = 'https://api.themoviedb.org/3/'
const IMAGES = 'https://image.tmdb.org/t/p/'
const MAX_RETRIES = 3
const IGNORED_IN_FIXTURE_NAMES = new Set(['api_key', 'language', 'include_image_language', 'append_to_response'])

// 'search/movie', {query:'The Matrix', year:1999} → 'search_movie__query=the-matrix_year=1999.json'
export function fixtureName(path: string, params: Record<string, string | number>): string {
  const parts = Object.keys(params)
    .filter((k) => !IGNORED_IN_FIXTURE_NAMES.has(k))
    .sort()
    .map((k) => `${k}=${normalizeTitle(String(params[k])).replace(/ /g, '-')}`)
  return `${path.replace(/\//g, '_')}${parts.length ? `__${parts.join('_')}` : ''}.json`
}

export function createTmdbClient(opts: Options): TmdbClient {
  const fetchImpl = opts.fetch ?? fetch
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))

  const credentialOrThrow = () => {
    const credential = opts.credential()
    if (!credential) throwAppError({ code: 'tmdb_key_invalid', message: 'No TMDB API key has been saved.' })
    return credential
  }

  async function live<T>(path: string, params: Record<string, string | number>): Promise<T> {
    const credential = credentialOrThrow()
    const url = new URL(path, API)
    // A v4 read access token is a JWT; anything else is a v3 API key.
    const bearer = credential.startsWith('eyJ')
    if (!bearer) url.searchParams.set('api_key', credential)
    url.searchParams.set('language', 'en-US')
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v))
    const headers: Record<string, string> = { accept: 'application/json' }
    if (bearer) headers['authorization'] = `Bearer ${credential}`

    for (let attempt = 0; ; attempt++) {
      let res: Response
      try {
        res = await fetchImpl(url.toString(), { headers })
      } catch (e) {
        throwAppError({ code: 'tmdb_unavailable', payload: { cause: e instanceof Error ? e.message : String(e) } })
      }
      if (res.status === 429 && attempt < MAX_RETRIES) {
        await sleep((Number(res.headers.get('retry-after')) || 2) * 1000)
        continue
      }
      if (res.status === 401) throwAppError('tmdb_key_invalid')
      if (res.status === 404) throwAppError('tmdb_not_found')
      if (!res.ok) throwAppError({ code: 'tmdb_unavailable', payload: { status: res.status } })
      return (await res.json()) as T
    }
  }

  async function fixture<T>(path: string, params: Record<string, string | number>): Promise<T> {
    if (credentialOrThrow() === 'invalid') throwAppError('tmdb_key_invalid')
    try {
      return JSON.parse(await readFile(join(opts.fixturesDir, fixtureName(path, params)), 'utf8')) as T
    } catch {
      throwAppError({ code: 'tmdb_not_found', payload: { fixture: fixtureName(path, params) } })
    }
  }

  return {
    get: (path, params = {}) => (opts.mode === 'fixtures' ? fixture(path, params) : live(path, params)),
    async image(size, tmdbPath, dest) {
      if (opts.mode === 'fixtures') return copyFile(join(opts.fixturesDir, 'image.png'), dest)
      let res: Response
      try {
        res = await fetchImpl(`${IMAGES}${size}${tmdbPath}`)
      } catch (e) {
        throwAppError({ code: 'tmdb_unavailable', payload: { cause: e instanceof Error ? e.message : String(e) } })
      }
      if (!res.ok) throwAppError({ code: res.status === 404 ? 'tmdb_not_found' : 'tmdb_unavailable' })
      await writeFile(dest, Buffer.from(await res.arrayBuffer()))
    }
  }
}

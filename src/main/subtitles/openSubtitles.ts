import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { throwAppError } from '@shared/appError'
import { normalizeLang } from '@shared/lang'
import type { SubtitleResult } from '@shared/subtitleSearch'

export type OpenSubtitlesSecrets = { apiKey: string; username: string; password: string }

export type SubtitleQuery = {
  hash?: string
  tmdbId?: number
  parentTmdbId?: number
  season?: number
  episode?: number
  query?: string
  year?: number
  language: string // OpenSubtitles' code: 'en', 'pt-br'
}

type Options = {
  secrets: () => OpenSubtitlesSecrets | null
  mode: 'live' | 'fixtures'
  fixturesDir: string
  userAgent: string
  fetch?: typeof fetch
  timeoutMs?: number
}

type Reply = { status: number; body: Record<string, unknown> }
type Attributes = {
  language?: string
  download_count?: number
  hearing_impaired?: boolean
  foreign_parts_only?: boolean
  moviehash_match?: boolean
  release?: string
  format?: string | null
  files?: { file_id: number; file_name?: string }[]
}

const API = 'https://api.opensubtitles.com/api/v1/'
const FIXTURE_LINK = 'fixture:'

const unavailable = (cause: unknown): never =>
  throwAppError({ code: 'opensubtitles_unavailable', payload: { cause: cause instanceof Error ? cause.message : String(cause) } })

// 'GET', 'subtitles', {languages:'en', tmdb_id:603} → 'get_subtitles__languages=en_tmdb_id=603.json'.
// The file hash is left out, so fixtures don't depend on the test video's bytes.
export function fixtureName(method: string, path: string, params: Record<string, string>): string {
  const parts = Object.keys(params)
    .filter((k) => k !== 'moviehash')
    .sort()
    .map((k) => `${k}=${params[k]!.toLowerCase().replace(/[^a-z0-9-]+/g, '-')}`)
  return `${method.toLowerCase()}_${path.replace(/\//g, '_')}${parts.length ? `__${parts.join('_')}` : ''}.json`
}

// The OpenSubtitles REST API (api.opensubtitles.com), used only when the user
// searches from the player. The login token lives in memory for this run only.
export function createOpenSubtitles(opts: Options) {
  const fetchImpl = opts.fetch ?? fetch
  const timeoutMs = opts.timeoutMs ?? 15_000
  let token: string | null = null
  let base = API
  let remaining: number | null = null

  // fetch with a deadline: a hung request must not leave the panel spinning.
  async function timed(url: string, init: RequestInit): Promise<Response> {
    const abort = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        abort.abort()
        reject(new Error('timed out'))
      }, timeoutMs)
    })
    try {
      return await Promise.race([fetchImpl(url, { ...init, signal: abort.signal }), deadline])
    } catch (e) {
      return unavailable(e)
    } finally {
      clearTimeout(timer)
    }
  }

  async function request(method: 'GET' | 'POST', path: string, p: { params?: Record<string, string>; body?: unknown; auth?: boolean } = {}): Promise<Reply> {
    const params = p.params ?? {}
    if (opts.mode === 'fixtures') {
      const file = join(opts.fixturesDir, fixtureName(method, path, params))
      return { status: 200, body: JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown> }
    }
    const secrets = opts.secrets()!
    const url = new URL(path, base)
    for (const k of Object.keys(params).sort()) url.searchParams.set(k, params[k]!)
    const headers: Record<string, string> = { 'Api-Key': secrets.apiKey, 'User-Agent': opts.userAgent, Accept: 'application/json' }
    if (p.body !== undefined) headers['Content-Type'] = 'application/json'
    if (p.auth && token) headers['Authorization'] = `Bearer ${token}`
    const res = await timed(url.toString(), { method, headers, body: p.body === undefined ? undefined : JSON.stringify(p.body) })
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
    return { status: res.status, body }
  }

  async function login(): Promise<void> {
    const secrets = opts.secrets()
    if (!secrets) throwAppError('opensubtitles_not_set_up')
    if (token) return
    const r = await request('POST', 'login', { body: { username: secrets.username, password: secrets.password } })
    if (r.status === 400 || r.status === 401 || r.status === 403) throwAppError('opensubtitles_login')
    if (r.status !== 200 || typeof r.body['token'] !== 'string') unavailable(`login ${r.status}`)
    token = r.body['token'] as string
    if (typeof r.body['base_url'] === 'string' && opts.mode === 'live') base = `https://${r.body['base_url']}/api/v1/`
  }

  // A signed-in request; an expired token gets one fresh login.
  async function authed(method: 'GET' | 'POST', path: string, p: { params?: Record<string, string>; body?: unknown } = {}): Promise<Reply> {
    await login()
    let r = await request(method, path, { ...p, auth: true })
    if (r.status === 401) {
      token = null
      await login()
      r = await request(method, path, { ...p, auth: true })
      if (r.status === 401) throwAppError('opensubtitles_login')
    }
    return r
  }

  return {
    async search(q: SubtitleQuery): Promise<SubtitleResult[]> {
      const params: Record<string, string> = { languages: q.language }
      if (q.hash) params['moviehash'] = q.hash
      if (q.tmdbId !== undefined) params['tmdb_id'] = String(q.tmdbId)
      if (q.parentTmdbId !== undefined) params['parent_tmdb_id'] = String(q.parentTmdbId)
      if (q.season !== undefined) params['season_number'] = String(q.season)
      if (q.episode !== undefined) params['episode_number'] = String(q.episode)
      if (q.query) params['query'] = q.query
      if (q.year !== undefined) params['year'] = String(q.year)
      const r = await authed('GET', 'subtitles', { params })
      if (r.status !== 200) unavailable(`search ${r.status}`)
      const data = (r.body['data'] ?? []) as { attributes?: Attributes }[]
      const results: SubtitleResult[] = []
      for (const item of data) {
        const a = item.attributes ?? {}
        for (const f of a.files ?? []) {
          results.push({
            fileId: f.file_id,
            language: normalizeLang(a.language) ?? a.language ?? '',
            release: a.release || f.file_name || 'Subtitle',
            hashMatch: a.moviehash_match === true,
            sdh: a.hearing_impaired === true,
            forced: a.foreign_parts_only === true,
            downloads: a.download_count ?? 0,
            format: a.format || (f.file_name?.split('.').pop() ?? 'srt')
          })
        }
      }
      return results.sort((x, y) => Number(y.hashMatch) - Number(x.hashMatch) || y.downloads - x.downloads)
    },

    async download(fileId: number): Promise<{ content: Buffer; fileName: string; remaining: number; resetAt: string | null }> {
      const r = await authed('POST', 'download', { body: { file_id: fileId } })
      const resetAt = typeof r.body['reset_time_utc'] === 'string' ? (r.body['reset_time_utc'] as string) : null
      if (r.status === 406) {
        remaining = 0
        throwAppError({ code: 'opensubtitles_quota', payload: { resetAt } })
      }
      if (r.status !== 200 || typeof r.body['link'] !== 'string') unavailable(`download ${r.status}`)
      const link = r.body['link'] as string
      remaining = typeof r.body['remaining'] === 'number' ? (r.body['remaining'] as number) : remaining
      let content: Buffer
      if (opts.mode === 'fixtures' && link.startsWith(FIXTURE_LINK)) {
        content = await readFile(join(opts.fixturesDir, link.slice(FIXTURE_LINK.length)))
      } else {
        const file = await timed(link, { headers: { 'User-Agent': opts.userAgent } })
        if (!file.ok) unavailable(`file ${file.status}`)
        content = Buffer.from(await file.arrayBuffer())
      }
      return { content, fileName: String(r.body['file_name'] ?? ''), remaining: remaining ?? 0, resetAt }
    },

    async account(): Promise<{ username: string; remaining: number }> {
      const r = await authed('GET', 'infos/user')
      if (r.status !== 200) unavailable(`user ${r.status}`)
      const d = (r.body['data'] ?? {}) as { username?: string; remaining_downloads?: number }
      remaining = d.remaining_downloads ?? remaining
      return { username: d.username ?? opts.secrets()?.username ?? '', remaining: d.remaining_downloads ?? 0 }
    },

    // Downloads left today, as last reported (null before any request).
    remaining: () => remaining,

    // A new login was saved: forget the old token.
    reset() {
      token = null
      base = API
    }
  }
}

export type OpenSubtitles = ReturnType<typeof createOpenSubtitles>

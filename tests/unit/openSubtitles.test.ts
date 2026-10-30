import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseAppError } from '@shared/appError'
import { createOpenSubtitles, type OpenSubtitlesSecrets } from '../../src/main/subtitles/openSubtitles'

const SECRETS: OpenSubtitlesSecrets = { apiKey: 'KEY', username: 'neo', password: 'pw' }
const FIXTURES = join(__dirname, '..', 'fixtures', 'opensubtitles')

type Call = { url: URL; init: RequestInit }
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const sub = (fileId: number, o: { lang?: string; dl?: number; hash?: boolean; hi?: boolean; forced?: boolean } = {}) => ({
  id: String(fileId),
  type: 'subtitle',
  attributes: {
    language: o.lang ?? 'en',
    download_count: o.dl ?? 10,
    hearing_impaired: o.hi ?? false,
    foreign_parts_only: o.forced ?? false,
    moviehash_match: o.hash ?? false,
    release: `Release ${fileId}`,
    format: 'srt',
    files: [{ file_id: fileId, file_name: `release.${fileId}.srt` }]
  }
})

// A fake OpenSubtitles: login, search, download, and per-test overrides.
function server(over: Partial<Record<'login' | 'subtitles' | 'download' | 'user', () => Response | Promise<Response>>> = {}) {
  const calls: Call[] = []
  const fetch = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input))
    calls.push({ url, init })
    const path = url.pathname.replace('/api/v1/', '')
    if (path === 'login') return over.login?.() ?? json(200, { token: 'T1', base_url: 'api.opensubtitles.com', user: { allowed_downloads: 20 } })
    if (path === 'subtitles') return over.subtitles?.() ?? json(200, { data: [sub(1, { dl: 5 }), sub(2, { dl: 50 }), sub(3, { dl: 1, hash: true })] })
    if (path === 'download') return over.download?.() ?? json(200, { link: 'https://dl.example/file.srt', file_name: 'x.srt', remaining: 18, reset_time_utc: '2026-10-31T00:00:00Z' })
    if (path === 'infos/user') return over.user?.() ?? json(200, { data: { username: 'neo', remaining_downloads: 19 } })
    if (url.hostname === 'dl.example') return new Response('1\r\n00:00:01,000 --> 00:00:02,000\r\nHi\r\n')
    return json(404, {})
  })
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls }
}

const client = (s: ReturnType<typeof server>, secrets: OpenSubtitlesSecrets | null = SECRETS) =>
  createOpenSubtitles({ secrets: () => secrets, mode: 'live', fixturesDir: FIXTURES, fetch: s.fetch, userAgent: 'VideoPlayer v0.1.0' })

async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p
  } catch (e) {
    return parseAppError(e)?.code
  }
  return undefined
}

afterEach(() => vi.useRealTimers())

describe('OpenSubtitles client', () => {
  it('logs in once with the API key and app name, then searches with the token', async () => {
    const s = server()
    const os = client(s)
    await os.search({ tmdbId: 603, language: 'en' })
    await os.search({ tmdbId: 603, language: 'en' })
    const logins = s.calls.filter((c) => c.url.pathname.endsWith('/login'))
    expect(logins).toHaveLength(1)
    const headers = new Headers(logins[0]!.init.headers)
    expect(headers.get('Api-Key')).toBe('KEY')
    expect(headers.get('User-Agent')).toBe('VideoPlayer v0.1.0')
    expect(JSON.parse(String(logins[0]!.init.body))).toEqual({ username: 'neo', password: 'pw' })
    const search = s.calls.find((c) => c.url.pathname.endsWith('/subtitles'))!
    expect(new Headers(search.init.headers).get('Authorization')).toBe('Bearer T1')
  })

  it('searches a movie by file hash and TMDB id in the chosen language', async () => {
    const s = server()
    await client(s).search({ hash: '8e245d9679d31e12', tmdbId: 603, language: 'en' })
    const q = s.calls.find((c) => c.url.pathname.endsWith('/subtitles'))!.url.searchParams
    expect(Object.fromEntries(q)).toEqual({ languages: 'en', moviehash: '8e245d9679d31e12', tmdb_id: '603' })
  })

  it('searches an episode by show id, season and episode', async () => {
    const s = server()
    await client(s).search({ parentTmdbId: 1396, season: 1, episode: 2, language: 'fr' })
    const q = s.calls.find((c) => c.url.pathname.endsWith('/subtitles'))!.url.searchParams
    expect(Object.fromEntries(q)).toEqual({ episode_number: '2', languages: 'fr', parent_tmdb_id: '1396', season_number: '1' })
  })

  it('lists files matching the video first, then by downloads', async () => {
    const results = await client(server()).search({ tmdbId: 603, language: 'en' })
    expect(results.map((r) => r.fileId)).toEqual([3, 2, 1])
    expect(results[0]).toMatchObject({ hashMatch: true, language: 'eng', release: 'Release 3', format: 'srt', sdh: false, forced: false })
  })

  it('downloads a file and reports what is left today', async () => {
    const d = await client(server()).download(2)
    expect(d.content.toString()).toContain('Hi')
    expect(d).toMatchObject({ remaining: 18, resetAt: '2026-10-31T00:00:00Z' })
  })

  it('logs in again once when the token has expired, then gives up', async () => {
    let n = 0
    const s = server({ subtitles: () => (++n === 1 ? json(401, {}) : json(200, { data: [] })) })
    expect(await client(s).search({ tmdbId: 1, language: 'en' })).toEqual([])
    expect(s.calls.filter((c) => c.url.pathname.endsWith('/login'))).toHaveLength(2)
    expect(await codeOf(client(server({ subtitles: () => json(401, {}) })).search({ tmdbId: 1, language: 'en' }))).toBe('opensubtitles_login')
  })

  it('reports a wrong login', async () => {
    expect(await codeOf(client(server({ login: () => json(401, { message: 'bad' }) })).search({ tmdbId: 1, language: 'en' }))).toBe('opensubtitles_login')
  })

  it('reports the daily limit with its reset time', async () => {
    const s = server({ download: () => json(406, { remaining: 0, reset_time_utc: '2026-10-31T00:00:00Z', message: 'limit' }) })
    let error: unknown
    await client(s)
      .download(1)
      .catch((e: unknown) => (error = e))
    expect(parseAppError(error)).toMatchObject({ code: 'opensubtitles_quota', payload: { resetAt: '2026-10-31T00:00:00Z' } })
  })

  it('gives up on a request that hangs', async () => {
    vi.useFakeTimers()
    const hang = server({
      subtitles: () => new Promise<Response>(() => {})
    })
    const os = createOpenSubtitles({ secrets: () => SECRETS, mode: 'live', fixturesDir: FIXTURES, fetch: hang.fetch, userAgent: 'x', timeoutMs: 15_000 })
    const result = codeOf(os.search({ tmdbId: 1, language: 'en' }))
    await vi.advanceTimersByTimeAsync(15_001)
    expect(await result).toBe('opensubtitles_unavailable')
  })

  it('reports the network being down', async () => {
    const down = vi.fn(async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    const os = createOpenSubtitles({ secrets: () => SECRETS, mode: 'live', fixturesDir: FIXTURES, fetch: down, userAgent: 'x' })
    expect(await codeOf(os.search({ tmdbId: 1, language: 'en' }))).toBe('opensubtitles_unavailable')
  })

  it('makes no request at all without an account', async () => {
    const s = server()
    expect(await codeOf(client(s, null).search({ tmdbId: 1, language: 'en' }))).toBe('opensubtitles_not_set_up')
    expect(s.fetch).not.toHaveBeenCalled()
  })

  it('reads the account name and downloads left', async () => {
    expect(await client(server()).account()).toEqual({ username: 'neo', remaining: 19 })
  })

  it('serves recorded responses in fixture mode', async () => {
    const os = createOpenSubtitles({ secrets: () => SECRETS, mode: 'fixtures', fixturesDir: FIXTURES, userAgent: 'x' })
    const results = await os.search({ hash: 'anything', tmdbId: 603, language: 'en' })
    expect(results.length).toBeGreaterThan(1)
    expect(results.some((r) => r.hashMatch)).toBe(true)
    const d = await os.download(results[0]!.fileId)
    expect(d.content.toString()).toContain('-->')
  })
})

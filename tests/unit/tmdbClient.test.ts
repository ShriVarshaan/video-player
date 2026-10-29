import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseAppError } from '@shared/appError'
import { createTmdbClient, fixtureName } from '../../src/main/metadata/tmdbClient'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vp-tmdb-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

function live(credential: string, fetch: typeof globalThis.fetch, sleep = vi.fn(async () => {})) {
  return { client: createTmdbClient({ credential: () => credential, mode: 'live', fixturesDir: dir, fetch, sleep }), sleep }
}

const code = (e: unknown) => parseAppError(e)?.code

describe('live mode', () => {
  it('sends a v3 key as api_key with en-US', async () => {
    const fetch = vi.fn(async () => json({ ok: 1 }))
    await live('abc', fetch).client.get('search/movie', { query: 'The Matrix', year: 1999 })
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('https://api.themoviedb.org/3/search/movie?')
    expect(url).toContain('api_key=abc')
    expect(url).toContain('language=en-US')
    expect(url).toContain('query=The+Matrix')
    expect(new Headers(init.headers).get('authorization')).toBeNull()
  })

  it('sends a v4 token as a bearer header', async () => {
    const fetch = vi.fn(async () => json({}))
    await live('eyJx', fetch).client.get('movie/603')
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).not.toContain('api_key')
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer eyJx')
  })

  it('maps 401 to tmdb_key_invalid and 404 to tmdb_not_found', async () => {
    expect(code(await live('k', async () => json({}, 401)).client.get('movie/1').catch((e) => e))).toBe('tmdb_key_invalid')
    expect(code(await live('k', async () => json({}, 404)).client.get('movie/1').catch((e) => e))).toBe('tmdb_not_found')
  })

  it('waits Retry-After on 429, then retries', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json({}, 429, { 'retry-after': '1' }))
      .mockResolvedValueOnce(json({ results: [] }))
    const { client, sleep } = live('k', fetch)
    expect(await client.get('search/movie', { query: 'x' })).toEqual({ results: [] })
    expect(sleep).toHaveBeenCalledWith(1000)
  })

  it('gives every request a timeout', async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => json({}))
    const { client } = live('k', fetch as unknown as typeof globalThis.fetch)
    await client.get('movie/1')
    await client.image('w500', '/a.jpg', join(dir, 'a.jpg'))
    for (const call of fetch.mock.calls) expect(call[1]?.signal).toBeInstanceOf(AbortSignal)
  })

  it('maps network failures to tmdb_unavailable', async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError('fetch failed')
    })
    expect(code(await live('k', fetch).client.get('movie/1').catch((e) => e))).toBe('tmdb_unavailable')
  })

  it('fails without a credential', async () => {
    const client = createTmdbClient({ credential: () => null, mode: 'live', fixturesDir: dir, fetch: vi.fn() })
    expect(code(await client.get('movie/1').catch((e) => e))).toBe('tmdb_key_invalid')
  })
})

describe('fixtures mode', () => {
  it('names fixture files from path and params', () => {
    expect(fixtureName('search/movie', { query: 'The Matrix', year: 1999, language: 'en-US' })).toBe(
      'search_movie__query=the-matrix_year=1999.json'
    )
    expect(fixtureName('tv/1396/season/1', {})).toBe('tv_1396_season_1.json')
  })

  it('reads fixtures instead of the network', async () => {
    writeFileSync(join(dir, 'search_movie__query=the-matrix_year=1999.json'), '{"results":[{"id":603}]}')
    const fetch = vi.fn()
    const client = createTmdbClient({ credential: () => 'k', mode: 'fixtures', fixturesDir: dir, fetch })
    expect(await client.get('search/movie', { query: 'The Matrix', year: 1999 })).toEqual({ results: [{ id: 603 }] })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('treats a missing fixture as not found and "invalid" as a bad key', async () => {
    const client = createTmdbClient({ credential: () => 'k', mode: 'fixtures', fixturesDir: dir })
    expect(code(await client.get('movie/1').catch((e) => e))).toBe('tmdb_not_found')
    const bad = createTmdbClient({ credential: () => 'invalid', mode: 'fixtures', fixturesDir: dir })
    expect(code(await bad.get('authentication').catch((e) => e))).toBe('tmdb_key_invalid')
  })

  it('copies the stand-in image', async () => {
    writeFileSync(join(dir, 'image.png'), 'png bytes')
    mkdirSync(join(dir, 'out'))
    const client = createTmdbClient({ credential: () => 'k', mode: 'fixtures', fixturesDir: dir })
    await client.image('w500', '/abc.jpg', join(dir, 'out', 'a.png'))
    const { readFileSync } = await import('node:fs')
    expect(readFileSync(join(dir, 'out', 'a.png'), 'utf8')).toBe('png bytes')
  })
})

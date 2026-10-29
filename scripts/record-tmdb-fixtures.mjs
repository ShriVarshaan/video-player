// Usage: TMDB_TOKEN=<v4 read access token> node scripts/record-tmdb-fixtures.mjs
// Re-records tests/fixtures/tmdb/*.json from the real TMDB API: exactly the
// requests the app makes for the fixture library (tests/fixtures/library).
// The token is read from the environment and never written anywhere.
// Images are not recorded; tests use the committed stand-in image.png.
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const token = process.env.TMDB_TOKEN
if (!token) {
  console.error('Set TMDB_TOKEN to a TMDB v4 read access token.')
  process.exit(1)
}
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures', 'tmdb')
const DETAIL = { append_to_response: 'credits,images', include_image_language: 'en,null' }

// The requests matchPending makes for the fixture library.
const REQUESTS = [
  ['authentication', {}],
  ['search/movie', { query: 'The Matrix', year: 1999 }],
  ['search/movie', { query: 'Amélie', year: 2001 }],
  ['search/movie', { query: 'inception', year: 2010 }],
  ['search/movie', { query: 'Some Unknown Home Video' }],
  ['movie/603', DETAIL],
  ['movie/194', DETAIL],
  ['movie/27205', DETAIL],
  ['search/tv', { query: 'Breaking Bad' }],
  ['tv/1396', DETAIL],
  ['tv/1396/season/1', {}],
  ['tv/1396/season/2', {}]
]

// Same rule as fixtureName() in src/main/metadata/tmdbClient.ts.
const IGNORED = new Set(['api_key', 'language', 'include_image_language', 'append_to_response'])
const normalize = (s) =>
  s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/&/g, ' and ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
function fixtureName(path, params) {
  const parts = Object.keys(params)
    .filter((k) => !IGNORED.has(k))
    .sort()
    .map((k) => `${k}=${normalize(String(params[k])).replace(/ /g, '-')}`)
  return `${path.replace(/\//g, '_')}${parts.length ? `__${parts.join('_')}` : ''}.json`
}

for (const [path, params] of REQUESTS) {
  const url = new URL(path, 'https://api.themoviedb.org/3/')
  url.searchParams.set('language', 'en-US')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v))
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } })
  if (!res.ok) {
    console.error(`${path}: HTTP ${res.status}`)
    process.exit(1)
  }
  const name = fixtureName(path, params)
  writeFileSync(join(out, name), JSON.stringify(await res.json(), null, 2) + '\n')
  console.log(`recorded ${name}`)
}

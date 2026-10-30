// Records real OpenSubtitles search responses into tests/fixtures/opensubtitles
// for VP_OPENSUBS_MODE=fixtures. Credentials come from the environment for this
// one command and are never written anywhere:
//   OS_API_KEY=… OS_USERNAME=… OS_PASSWORD=… node scripts/record-opensubtitles-fixtures.mjs
// It searches only (no downloads, so the daily quota is untouched). The login,
// download and user fixtures stay hand-written; the token is never saved.
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const { OS_API_KEY: apiKey, OS_USERNAME: username, OS_PASSWORD: password } = process.env
if (!apiKey || !username || !password) {
  console.error('Set OS_API_KEY, OS_USERNAME and OS_PASSWORD for this command.')
  process.exit(1)
}

const dir = resolve('tests', 'fixtures', 'opensubtitles')
const headers = { 'Api-Key': apiKey, 'User-Agent': 'VideoPlayer v0.1.0', Accept: 'application/json', 'Content-Type': 'application/json' }

// Same naming as fixtureName() in src/main/subtitles/openSubtitles.ts.
const fixtureName = (method, path, params) => {
  const parts = Object.keys(params)
    .filter((k) => k !== 'moviehash')
    .sort()
    .map((k) => `${k}=${String(params[k]).toLowerCase().replace(/[^a-z0-9-]+/g, '-')}`)
  return `${method.toLowerCase()}_${path.replace(/\//g, '_')}${parts.length ? `__${parts.join('_')}` : ''}.json`
}

const login = await fetch('https://api.opensubtitles.com/api/v1/login', { method: 'POST', headers, body: JSON.stringify({ username, password }) })
if (!login.ok) {
  console.error(`Login failed: ${login.status}`)
  process.exit(1)
}
const { token, base_url: baseUrl } = await login.json()

const SEARCHES = [
  { languages: 'en', tmdb_id: 603 }, // The Matrix
  { episode_number: 1, languages: 'en', parent_tmdb_id: 1396, season_number: 1 } // Breaking Bad S01E01
]

for (const params of SEARCHES) {
  const url = new URL(`https://${baseUrl}/api/v1/subtitles`)
  for (const k of Object.keys(params).sort()) url.searchParams.set(k, String(params[k]))
  const res = await fetch(url, { headers: { ...headers, Authorization: `Bearer ${token}` } })
  if (!res.ok) {
    console.error(`Search failed (${res.status}) for ${url.search}`)
    continue
  }
  const body = await res.json()
  // Keep the first few results; mark one as matching the file so the badge is exercised.
  body.data = body.data.slice(0, 6)
  if (body.data[0]) body.data[body.data.length - 1].attributes.moviehash_match = true
  const file = join(dir, fixtureName('GET', 'subtitles', params))
  writeFileSync(file, JSON.stringify(body, null, 2) + '\n')
  console.log(`wrote ${file}`)
}

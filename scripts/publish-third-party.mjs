// Usage: GH_TOKEN=… node scripts/publish-third-party.mjs   (only with the user's permission)
// Uploads release/third-party/ (made by make-third-party.mjs) to the mirror release in this repo,
// creating it as a public pre-release that is never marked latest. Files already there at the
// same size are skipped, so it can be run again after a failed upload. The token is read from
// GH_TOKEN for this one command and never written anywhere.
import { execFileSync } from 'node:child_process'
import { createReadStream, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { mirrorPage, mirrorRelease } from './third-party-lib.mjs'

const manifest = JSON.parse(readFileSync(join('vendor', 'manifest.json'), 'utf8'))
const dir = join('release', 'third-party')
const token = process.env.GH_TOKEN ?? ''
const { repo, tag } = manifest.mirror
const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'cinewall-mirror', Authorization: `Bearer ${token}` }

async function api(path, init = {}) {
  const res = await fetch(`https://api.github.com/repos/${repo}${path}`, { ...init, headers: { ...headers, ...init.headers } })
  if (res.status === 404 && (init.method ?? 'GET') === 'GET') return null
  if (!res.ok) throw new Error(`GitHub ${init.method ?? 'GET'} ${path}: HTTP ${res.status} ${await res.text()}`)
  return res.status === 204 ? null : res.json()
}

async function main() {
  if (!token) throw new Error('GH_TOKEN is not set: give it for this one command, and never save it to a file.')
  const files = readdirSync(dir).filter((f) => !f.endsWith('.part'))
  for (const p of manifest.packages) {
    const file = p.url.split('/').pop()
    if (!files.includes(file) || !files.includes(`${p.name}-source.tar`)) throw new Error(`${dir} is missing ${p.name}'s files: run node scripts/make-third-party.mjs first.`)
  }

  let release = await api(`/releases/tags/${tag}`)
  if (!release) {
    const body = readFileSync(join(dir, 'SOURCES.md'), 'utf8')
    const commit = execFileSync('git', ['rev-parse', 'origin/main'], { encoding: 'utf8' }).trim()
    release = await api('/releases', { method: 'POST', body: JSON.stringify(mirrorRelease(manifest, body, commit)) })
    console.log(`Created ${release.html_url}`)
  }
  if (!release.prerelease) throw new Error(`${tag} exists but isn't a pre-release: fix it on GitHub first, or the app's update check could pick it.`)

  for (const file of files) {
    const size = statSync(join(dir, file)).size
    const existing = release.assets.find((a) => a.name === file)
    if (existing?.size === size && existing.state === 'uploaded') {
      console.log(`${file}: already there`)
      continue
    }
    if (existing) await api(`/releases/assets/${existing.id}`, { method: 'DELETE' })
    console.log(`${file}: uploading ${Math.round(size / 1e6)} MB…`)
    const res = await fetch(`https://uploads.github.com/repos/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(file)}`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/octet-stream', 'Content-Length': String(size) },
      body: Readable.toWeb(createReadStream(join(dir, file))),
      duplex: 'half'
    })
    if (!res.ok) throw new Error(`${file}: upload failed, HTTP ${res.status} ${await res.text()}`)
  }

  // What fetch-vendor and the app's links rely on, checked from outside the account.
  for (const p of manifest.packages) {
    const res = await fetch(p.url, { method: 'HEAD', redirect: 'follow' })
    if (!res.ok) throw new Error(`${p.url} isn't downloadable yet (HTTP ${res.status}).`)
  }
  console.log(`\nThe mirror is up: ${mirrorPage(manifest)}`)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exitCode = 1
})

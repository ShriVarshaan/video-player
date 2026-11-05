// npm run release: checks everything, builds the installer and uploads a DRAFT GitHub release.
// It never publishes: a person tests the draft and publishes it by hand.
// The token comes only from GH_TOKEN, for this one command. Only the upload step is given it.
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { checkRelease, notesFor } from './releaseChecks.mjs'

const REPO = 'ShriVarshaan/video-player'
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()

class Stopped extends Error {}

// Thrown, not process.exit: exiting straight after a fetch crashes Node on Windows.
function stop(lines) {
  throw new Stopped(['Release stopped. Nothing was uploaded.', ...lines.map((l) => `- ${l}`)].join('\n'))
}

async function publishedVersions(token) {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'cinewall-release' }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=100`, { headers })
  if (!res.ok) stop([`GitHub's list of releases could not be read (HTTP ${res.status}).`])
  const releases = await res.json()
  return releases.filter((r) => !r.draft).map((r) => r.tag_name.replace(/^v/, ''))
}

// Runs a step without the token, so no test or build can see it.
function step(label, command, env = {}) {
  console.log(`\n== ${label}`)
  const { GH_TOKEN: _token, GITHUB_TOKEN: _other, ...clean } = process.env
  const r = spawnSync(command, { shell: true, stdio: 'inherit', env: { ...clean, ...env } })
  if (r.status !== 0) stop([`${label} failed.`])
}

async function release() {
  const token = process.env.GH_TOKEN ?? ''
  const { version } = JSON.parse(readFileSync('package.json', 'utf8'))
  const changelog = readFileSync('CHANGELOG.md', 'utf8')

  git('fetch', 'origin', 'main')
  const problems = checkRelease({
    branch: git('rev-parse', '--abbrev-ref', 'HEAD'),
    dirty: git('status', '--porcelain') !== '',
    head: git('rev-parse', 'HEAD'),
    originMain: git('rev-parse', 'origin/main'),
    version,
    published: await publishedVersions(token),
    hasToken: token !== '',
    changelog
  })
  if (problems.length > 0) stop(problems)

  step('Vendor files match their pinned hashes', 'npm run fetch-vendor')
  step('Typecheck', 'npm run typecheck')
  step('Unit tests', 'npm test')
  step('Sidecar tests', 'npm run test:sidecar')
  step('End-to-end tests', 'npm run test:e2e')
  step('Build the sidecar', 'npm run build-sidecar')
  step('Third-party notices', 'node scripts/make-notices.mjs')
  if (git('status', '--porcelain') !== '') stop(['A step changed the working tree (most likely THIRD_PARTY_NOTICES.md). Commit that first.'])
  step('Build the app', 'npm run build')

  // electron-builder takes the notes from a file. release/ is gitignored.
  mkdirSync('release', { recursive: true })
  const notesFile = join('release', 'release-notes.md')
  writeFileSync(notesFile, notesFor(changelog, version))
  console.log(`\n== Upload a draft of ${version}`)
  const upload = spawnSync(`npx electron-builder --win --publish always -c.publish.releaseType=draft "-c.releaseInfo.releaseNotesFile=${notesFile}"`, {
    shell: true,
    stdio: 'inherit',
    env: process.env
  })
  if (upload.status !== 0) stop(['The upload failed. Any draft it left can be replaced by running this again.'])
  console.log(`\nDraft ${version} is on GitHub. Test its installer, then publish it by hand: https://github.com/${REPO}/releases`)
}

try {
  await release()
} catch (e) {
  console.error(e instanceof Stopped ? e.message : e)
  process.exitCode = 1
}

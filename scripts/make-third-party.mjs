// Usage: node scripts/make-third-party.mjs
// Fills release/third-party/ with what the third-party mirror release holds (see third-party-lib.mjs):
// the exact mpv and FFmpeg archives from vendor/manifest.json, and the source they were built from,
// one .tar per package. It downloads with git and fetch only, and runs nothing it downloads.
// Safe to run again: finished archives are kept. Upload with scripts/publish-third-party.mjs.
import { execFileSync } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { archiveName, mirrorPage, parseScriptPins, scriptEnabled, svnListing } from './third-party-lib.mjs'
import { sha256File } from './vendor-lib.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'release', 'third-party')
const work = join(root, 'release', 'third-party-work')
const manifest = JSON.parse(readFileSync(join(root, 'vendor', 'manifest.json'), 'utf8'))

// Hooks and filters from a fetched repo never run: nothing is configured to, and file:// submodules are refused.
const git = (cwd, ...args) => execFileSync('git', ['-c', 'protocol.file.allow=never', '-c', 'core.autocrlf=false', '-c', 'core.longpaths=true', ...args], { cwd, stdio: ['ignore', 'ignore', 'pipe'] })

// Archive paths are passed relative to cwd: Git's GNU tar reads "C:\…" as a remote host.
const tar = (cwd, ...args) =>
  execFileSync('tar', args.map((a) => (/^[A-Za-z]:[\\/]/.test(a) ? relative(cwd, a) : a)), { cwd, stdio: ['ignore', 'ignore', 'pipe'] })

async function download(url, dest) {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${url}`)
  await pipeline(Readable.fromWeb(res.body), createWriteStream(`${dest}.part`))
  renameSync(`${dest}.part`, dest)
}

// The shipped archive itself, checked against the manifest's hash.
async function binary(pkg) {
  const file = pkg.url.split('/').pop()
  const dest = join(out, file)
  if (existsSync(dest) && (await sha256File(dest)) === pkg.sha256) return file
  for (const url of [pkg.url, pkg.upstream].filter(Boolean)) {
    try {
      await download(url, dest)
      if ((await sha256File(dest)) === pkg.sha256) return file
      rmSync(dest)
    } catch {}
  }
  throw new Error(`${file}: no copy with the manifest's SHA-256 (tried the mirror and upstream).`)
}

// A repo at one commit or tag, with its submodules, packed as .tar.gz (without .git).
function gitArchive(pin, dest) {
  const top = archiveName(pin.repo, pin.ref).replace(/\.tar\.gz$/, '')
  const parent = join(work, 'checkout')
  const dir = join(parent, top)
  rmSync(parent, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  git(dir, 'init', '-q')
  let fetched = false
  for (const url of [pin.repo, pin.mirror].filter(Boolean)) {
    try {
      git(dir, 'fetch', '-q', '--depth=1', url, pin.ref)
      // Relative submodule URLs (glib's `../../GNOME/gvdb.git`) resolve against origin; without
      // one git resolves them against the local folder, a file:// clone that is refused above.
      git(dir, 'remote', 'add', 'origin', url)
      fetched = true
      break
    } catch {}
  }
  if (!fetched) throw new Error(`could not fetch ${pin.ref} from ${pin.repo}`)
  git(dir, 'checkout', '-q', 'FETCH_HEAD')
  if (existsSync(join(dir, '.gitmodules'))) git(dir, 'submodule', 'update', '-q', '--init', '--recursive', '--depth=1')
  tar(parent, '-czf', dest, '--exclude=.git', top)
  rmSync(parent, { recursive: true, force: true })
}

// An svn folder at one revision, read over plain HTTP, packed as .tar.gz.
async function svnArchive(pin, dest) {
  const top = archiveName(pin.repo, pin.ref).replace(/\.tar\.gz$/, '')
  const dir = join(work, 'svn')
  rmSync(dir, { recursive: true, force: true })
  const u = new URL(pin.repo)
  const base = `${u.origin}${u.pathname.replace(/\/p\/([^/]+)\/svn\//, '/p/$1/svn/!svn/bc/' + pin.ref + '/')}`
  if (base === `${u.origin}${u.pathname}`) throw new Error(`can't read ${pin.repo} at r${pin.ref} over HTTP`)
  const enc = (rel) => rel.split('/').map(encodeURIComponent).join('/')
  const walk = async (path) => {
    const url = path ? `${base}/${enc(path)}/` : `${base}/`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
    for (const e of svnListing(await res.text())) {
      const rel = path ? `${path}/${e.name}` : e.name
      if (e.dir) await walk(rel)
      else {
        mkdirSync(dirname(join(dir, top, rel)), { recursive: true })
        await download(`${base}/${enc(rel)}`, join(dir, top, rel))
      }
    }
  }
  await walk('')
  tar(dir, '-czf', dest, top)
  rmSync(dir, { recursive: true, force: true })
}

async function archive(pin, folder) {
  const name = archiveName(pin.repo, pin.ref)
  const dest = join(folder, name)
  if (!existsSync(dest)) {
    console.log(`  ${name}`)
    if (pin.kind === 'svn') await svnArchive(pin, `${dest}.part`)
    else gitArchive(pin, `${dest}.part`)
    renameSync(`${dest}.part`, dest)
  }
  return name
}

// Every library the FFmpeg-Builds scripts pin for this build (read as text, never run).
function buildDependencies(buildsArchive, env) {
  const dir = join(work, 'ffmpeg-builds')
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  tar(dir, '-xzf', buildsArchive, '--strip-components=1')
  const scripts = []
  const scan = (d) => {
    for (const f of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (f.isDirectory()) scan(join(d, f.name))
      else if (f.name.endsWith('.sh')) scripts.push(join(d, f.name))
    }
  }
  scan(join(dir, 'scripts.d'))
  const read = (p) => (existsSync(join(dir, p)) ? readFileSync(join(dir, p), 'utf8') : '')
  const pins = []
  for (const s of scripts) {
    const text = readFileSync(s, 'utf8')
    if (/^SCRIPT_SKIP=/m.test(text) || !scriptEnabled(text, env, read)) continue
    for (const p of parseScriptPins(text)) pins.push({ ...p, script: relative(dir, s).replace(/\\/g, '/') })
  }
  rmSync(dir, { recursive: true, force: true })
  // Some repos appear in several scripts at the same ref.
  return pins.filter((p, i) => pins.findIndex((q) => q.repo === p.repo && q.ref === p.ref) === i)
}

const sizeMb = (f) => Math.round(statSync(f).size / 1e6)

async function main() {
  mkdirSync(out, { recursive: true })
  mkdirSync(work, { recursive: true })
  const notes = [
    '# Third-party files for Cinewall',
    '',
    `Mirror: ${mirrorPage(manifest)}`,
    '',
    "Cinewall ships mpv and FFmpeg as separate programs. This release keeps the exact archives it ships and the source they were built from, so both stay available even after the upstream builds are deleted. It is not a Cinewall version and the app never updates to it.",
    ''
  ]
  for (const pkg of manifest.packages) {
    console.log(`${pkg.name}`)
    const file = await binary(pkg)
    const folderName = `${pkg.name}-source`
    const folder = join(work, folderName)
    mkdirSync(folder, { recursive: true })
    const lines = [`## ${pkg.name} ${pkg.version}`, '', `Shipped archive: \`${file}\` (SHA-256 \`${pkg.sha256}\`)`]
    if (pkg.upstream) lines.push(`Originally published at: ${pkg.upstream}`)
    lines.push('', `Source, in \`${folderName}.tar\`:`, '')
    for (const s of pkg.sources) {
      const pin = { kind: 'git', repo: s.repo, ref: s.commit }
      const name = await archive(pin, folder)
      lines.push(`- \`${name}\`: ${s.name}, ${s.repo} at ${s.commit}`)
      if (s.dependencies) {
        const deps = buildDependencies(join(folder, name), s.dependencies)
        lines.push('', `Libraries the ${s.name} scripts pin for the ${s.dependencies.target}-${s.dependencies.variant} ${s.dependencies.addins} build:`, '')
        for (const d of deps) {
          const dep = await archive(d, folder)
          lines.push(`- \`${dep}\`: ${d.repo} at ${d.kind === 'svn' ? 'r' : ''}${d.ref} (\`${d.script}\`)`)
        }
      }
    }
    if (pkg.name === 'mpv') {
      lines.push(
        '',
        "mpv-winbuild-cmake builds most of mpv's libraries from the newest commit of each on the day it runs, and does not record those commits. The commits above are the ones mpv itself reports (mpv, its FFmpeg and libplacebo) plus the build scripts; the other libraries' source is in their projects' histories as of 2026-10-21."
      )
    }
    writeFileSync(join(folder, 'SOURCES.md'), lines.join('\n') + '\n')
    const tarFile = join(out, `${folderName}.tar`)
    if (existsSync(tarFile)) rmSync(tarFile)
    tar(work, '-cf', tarFile, folderName)
    console.log(`  ${folderName}.tar: ${sizeMb(tarFile)} MB`)
    if (statSync(tarFile).size > 1.9e9) throw new Error(`${folderName}.tar is over GitHub's 2 GB file limit: split it.`)
    notes.push(...lines, '')
  }
  writeFileSync(join(out, 'SOURCES.md'), notes.join('\n'))
  console.log(`\nDone: ${out}`)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exitCode = 1
})

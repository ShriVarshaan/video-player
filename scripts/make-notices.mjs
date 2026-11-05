// Writes THIRD_PARTY_NOTICES.md: everything the installer ships that someone else wrote, with its
// licence. Stops if a licence text can't be found, so a release can never go out with one missing.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const LICENCE_FILE = /^(licen[cs]e|copying|notice)([.\-_]|$)/i
// react and react-dom are bundled at build time, so they're dev dependencies.
const BUNDLED = ['react', 'react-dom']
// No licence file in the wheel. It offers a choice of three licences (see docs/third-party-sidecar.md).
const SIDECAR_LICENCE_OVERRIDES = { 'faust-cchardet': 'build/licenses/MPL-1.1.txt' }

// Each declares MIT in its package.json but ships no licence file. The second is koffi's own native
// code, published separately per platform, so koffi's licence covers it.
const NPM_LICENCE_OVERRIDES = { 'lazy-val': 'build/licenses/lazy-val.txt', '@koromix/koffi-win32-x64': 'node_modules/koffi/LICENSE.txt' }

const read = (path) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n').trim()

function licenceFiles(dir, recurse = false) {
  const found = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isFile() && (recurse || LICENCE_FILE.test(e.name))) found.push(join(dir, e.name))
    else if (e.isDirectory() && e.name === 'licenses') found.push(...licenceFiles(join(dir, e.name), true))
    else if (e.isDirectory() && recurse) found.push(...licenceFiles(join(dir, e.name), true))
  }
  return found.sort()
}

// As Node resolves it: the nearest node_modules, from the dependent's folder up to the root.
function findPackage(root, name, from) {
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name)
    if (existsSync(join(candidate, 'package.json'))) return candidate
    if (dir === root || dirname(dir) === dir) return null
  }
}

// The named packages and everything they depend on, sorted, with their licence texts.
export function npmPackages(root, names) {
  const seen = new Map()
  const visit = (name, from, optional = false) => {
    const dir = findPackage(root, name, from)
    if (!dir) {
      // Optional dependencies are often for other platforms, so what isn't installed doesn't ship.
      if (optional) return
      throw new Error(`make-notices: package ${name} isn't installed; run npm install.`)
    }
    if (seen.has(dir)) return
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    const override = NPM_LICENCE_OVERRIDES[pkg.name]
    const files = override ? [join(root, override)] : licenceFiles(dir).filter((f) => statSync(f).size > 0)
    if (files.length === 0) throw new Error(`make-notices: no licence text in ${dir}.`)
    seen.set(dir, { name: pkg.name, version: pkg.version, license: pkg.license ?? 'see text', text: files.map(read).join('\n\n') })
    for (const dep of Object.keys(pkg.dependencies ?? {})) visit(dep, dir)
    for (const dep of Object.keys(pkg.optionalDependencies ?? {})) visit(dep, dir, true)
  }
  for (const name of names) visit(name, root)
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name, 'en') || a.version.localeCompare(b.version, 'en'))
}

// Every row of the table in docs/third-party-sidecar.md, with licence texts from the sidecar's venv.
export function sidecarPackages(root) {
  const site = join(root, 'sidecar', '.venv', 'Lib', 'site-packages')
  if (!existsSync(site)) throw new Error('make-notices: sidecar/.venv is missing; run npm run setup-sidecar.')
  const installed = readdirSync(site)
  const rows = [...read(join(root, 'docs', 'third-party-sidecar.md')).matchAll(/^\| ([^|]+?) \| ([^|]+?) \| ([^|]+?) \|/gm)]
    .map((m) => ({ name: m[1], version: m[2], license: m[3] }))
    .filter((r) => r.name !== 'Package' && !r.name.startsWith('---'))
  if (rows.length === 0) throw new Error('make-notices: no packages found in docs/third-party-sidecar.md.')
  return rows.map((row) => {
    if (row.name === 'CPython runtime') {
      const home = /^home\s*=\s*(.+)$/m.exec(read(join(root, 'sidecar', '.venv', 'pyvenv.cfg')))?.[1]
      const file = home ? join(home.trim(), 'LICENSE.txt') : ''
      if (!file || !existsSync(file)) throw new Error('make-notices: no licence text for CPython.')
      return { ...row, text: read(file) }
    }
    const override = SIDECAR_LICENCE_OVERRIDES[row.name]
    if (override) return { ...row, text: read(join(root, override)) }
    const wanted = `${row.name}-${row.version}.dist-info`.toLowerCase().replace(/[-.]/g, '_')
    const folder = installed.find((d) => d.toLowerCase().replace(/[-.]/g, '_') === wanted)
    if (!folder) throw new Error(`make-notices: ${row.name} ${row.version} isn't installed in sidecar/.venv.`)
    const files = licenceFiles(join(site, folder))
    if (files.length === 0) throw new Error(`make-notices: no licence text for ${row.name}.`)
    return { ...row, text: files.map(read).join('\n\n') }
  })
}

function sourcePage(url) {
  const tag = /^(https:\/\/github\.com\/[^/]+\/[^/]+)\/releases\/download\/([^/]+)\//.exec(url)
  if (!tag) throw new Error(`make-notices: can't work out the source page of ${url}.`)
  return { repo: tag[1], release: `${tag[1]}/releases/tag/${tag[2]}` }
}

const section = (title, body) => `## ${title}\n\n${body}\n`
const block = (text) => `\`\`\`\`text\n${text}\n\`\`\`\``
const entry = (p) => `### ${p.name} ${p.version}\n\nLicence: ${p.license}\n\n${block(p.text)}\n`

export function generateNotices(root) {
  const { packages } = JSON.parse(readFileSync(join(root, 'vendor', 'manifest.json'), 'utf8'))
  const binary = (name) => {
    const pkg = packages.find((p) => p.name === name)
    if (!pkg) throw new Error(`make-notices: ${name} isn't in vendor/manifest.json.`)
    return { ...pkg, source: sourcePage(pkg.url) }
  }
  const mpv = binary('mpv')
  const ffmpeg = binary('ffmpeg')
  const own = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const electronLicence = read(join(root, 'node_modules', 'electron', 'dist', 'LICENSE'))
  const electronVersion = JSON.parse(readFileSync(join(root, 'node_modules', 'electron', 'package.json'), 'utf8')).version
  const npm = npmPackages(root, [...Object.keys(own.dependencies ?? {}), ...BUNDLED])
  const sidecar = sidecarPackages(root)
  const gpl3 = read(join(root, 'build', 'licenses', 'GPL-3.0.txt'))

  return [
    '# Third-party notices\n\nGenerated by `scripts/make-notices.mjs`. Cinewall ships with the software below. Each keeps its own licence.\n',
    section(
      'mpv',
      `Plays the video. Runs as a separate program.\n\nVersion: ${mpv.version}\nLicence: mpv is GPL-2.0-or-later. This build includes FFmpeg configured with --enable-gpl --enable-version3, so as a whole it is under GPL-3.0-or-later.\nThis build: ${mpv.source.release}\nSource and build scripts: ${mpv.source.repo}\nmpv's source: https://github.com/mpv-player/mpv\n\n${block(gpl3)}\n\n${block(read(join(root, 'build', 'licenses', 'GPL-2.0.txt')))}`
    ),
    section(
      'FFmpeg',
      `Reads video details and extracts subtitles and audio. Runs as a separate program, with replaceable shared libraries.\n\nVersion: ${ffmpeg.version}\nLicence: LGPL-3.0-or-later (built with --enable-version3). The LGPL adds to the GPL: its text is below, and the GPL's is in the mpv section above.\nThis build: ${ffmpeg.source.release}\nSource and build scripts: ${ffmpeg.source.repo}\nFFmpeg's source: https://ffmpeg.org/download.html\n\n${block(read(join(root, 'build', 'licenses', 'LGPL-3.0.txt')))}`
    ),
    section(
      'Electron',
      `Version: ${electronVersion}\nLicence: MIT\nChromium's and its other components' licences are in LICENSES.chromium.html, in the folder Cinewall is installed in.\n\n${block(electronLicence)}`
    ),
    section('npm packages', npm.map(entry).join('\n')),
    section('Auto sync helper', `The auto sync helper is built with PyInstaller, whose bootloader licence allows this.\n\n${sidecar.map(entry).join('\n')}`)
  ].join('\n')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const text = generateNotices(process.cwd())
  writeFileSync('THIRD_PARTY_NOTICES.md', text)
  console.log(`THIRD_PARTY_NOTICES.md: ${Math.round(text.length / 1024)} KB`)
}

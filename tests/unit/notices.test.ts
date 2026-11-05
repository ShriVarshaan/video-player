import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { generateNotices, npmPackages } from '../../scripts/make-notices.mjs'
import { LINKS } from '../../src/shared/links'

const root = process.cwd()
const manifest = JSON.parse(readFileSync('vendor/manifest.json', 'utf8')) as { packages: { name: string; version: string }[] }
const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { dependencies: Record<string, string> }

describe('third-party notices', () => {
  const text = generateNotices(root)

  it('names the exact mpv and FFmpeg builds, with their source and licences', () => {
    expect(LINKS.mpvSource).toBe('https://github.com/shinchiro/mpv-winbuild-cmake/releases/tag/20261021')
    expect(text).toContain(LINKS.mpvSource)
    expect(text).toContain(LINKS.ffmpegSource)
    for (const { version } of manifest.packages) expect(text).toContain(version)
    expect(text).toContain('GNU GENERAL PUBLIC LICENSE\n                       Version 2')
    expect(text).toContain('GNU GENERAL PUBLIC LICENSE\n                       Version 3')
    expect(text).toContain('GNU LESSER GENERAL PUBLIC LICENSE\n                       Version 3')
  })

  it('states the licence the shipped FFmpeg says it is under', () => {
    const avutil = readdirSync('vendor/ffmpeg').find((f) => /^avutil-.*\.dll$/.test(f))!
    expect(readFileSync(join('vendor/ffmpeg', avutil)).includes('LGPL version 3 or later')).toBe(true)
    expect(text).toContain('Licence: LGPL-3.0-or-later')
    // jschardet, further down, really is LGPL-2.1; FFmpeg's own section comes before Electron's.
    expect(text.slice(text.indexOf('## FFmpeg'), text.indexOf('## Electron'))).not.toContain('LGPL-2.1')
  })

  it('covers every npm package that ships, and Electron', () => {
    for (const name of ['koffi', 'react', 'react-dom', 'fuse.js', 'electron-updater', ...Object.keys(pkg.dependencies)]) {
      expect(text).toContain(`### ${name} `)
    }
    // A dependency of a dependency.
    expect(text).toContain('### scheduler ')
    // Where koffi's native code really is: an optional dependency, for this platform.
    expect(text).toContain('### @koromix/koffi-win32-x64 ')
    expect(text).toContain('## Electron')
  })

  it('covers every package in the sidecar list', () => {
    const doc = readFileSync('docs/third-party-sidecar.md', 'utf8')
    const rows = [...doc.matchAll(/^\| ([^|]+?) \| (\S+)[^|]* \|/gm)].map((m) => m[1]!).filter((n) => n !== 'Package' && !n.startsWith('---'))
    expect(rows.length).toBeGreaterThan(15)
    for (const name of rows) expect(text).toContain(`### ${name} `)
    expect(text).toContain('Mozilla Public License') // faust-cchardet ships no licence file
    expect(text).not.toContain('### auditok ')
  })

  it('the committed file is what the script makes today', () => {
    expect(readFileSync('THIRD_PARTY_NOTICES.md', 'utf8').replace(/\r\n/g, '\n')).toBe(text)
  })
})

describe('a missing licence stops the script', () => {
  let dir = ''
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  function fakePackage(name: string, files: Record<string, string> = {}) {
    dir = mkdtempSync(join(tmpdir(), 'vp-notices-'))
    const pkgDir = join(dir, 'node_modules', name)
    mkdirSync(pkgDir, { recursive: true })
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name, version: '1.0.0', license: 'MIT' }))
    for (const [file, content] of Object.entries(files)) writeFileSync(join(pkgDir, file), content)
    return dir
  }

  it('a package with no licence text', () => {
    expect(() => npmPackages(fakePackage('bare'), ['bare'])).toThrow(/no licence text/)
  })
  it('an empty licence file counts as none', () => {
    expect(() => npmPackages(fakePackage('empty', { LICENSE: '' }), ['empty'])).toThrow(/no licence text/)
  })
  it('a package that is not installed', () => {
    expect(() => npmPackages(fakePackage('there', { LICENSE: 'x' }), ['ghost'])).toThrow(/ghost/)
  })
  it('optional dependencies count when installed, and are skipped when not', () => {
    const root = fakePackage('host', { LICENSE: 'host text' })
    writeFileSync(
      join(root, 'node_modules', 'host', 'package.json'),
      JSON.stringify({ name: 'host', version: '1.0.0', license: 'MIT', optionalDependencies: { here: '1', 'other-platform': '1' } })
    )
    mkdirSync(join(root, 'node_modules', 'here'))
    writeFileSync(join(root, 'node_modules', 'here', 'package.json'), JSON.stringify({ name: 'here', version: '2.0.0', license: 'MIT' }))
    writeFileSync(join(root, 'node_modules', 'here', 'LICENSE'), 'here text')
    expect(npmPackages(root, ['host']).map((p) => p.name)).toEqual(['here', 'host'])
  })

  it('a dependency is found in a folder between its parent and the root', () => {
    const root = fakePackage('a', { LICENSE: 'a text' })
    const a = join(root, 'node_modules', 'a')
    writeFileSync(join(a, 'package.json'), JSON.stringify({ name: 'a', version: '1.0.0', license: 'MIT', dependencies: { b: '1' } }))
    for (const [dir, json] of [
      [join(a, 'node_modules', 'b'), { name: 'b', version: '1.0.0', license: 'MIT', dependencies: { c: '1' } }],
      [join(a, 'node_modules', 'c'), { name: 'c', version: '2.0.0', license: 'MIT' }],
      [join(root, 'node_modules', 'c'), { name: 'c', version: '1.0.0', license: 'MIT' }]
    ] as const) {
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'package.json'), JSON.stringify(json))
      writeFileSync(join(dir, 'LICENSE'), 'text')
    }
    expect(npmPackages(root, ['a']).find((p) => p.name === 'c')?.version).toBe('2.0.0')
  })

  it('a licence file under any usual name is found', () => {
    expect(npmPackages(fakePackage('named', { 'license.md': 'the text' }), ['named'])[0]?.text).toBe('the text')
  })
})

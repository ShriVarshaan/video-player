import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { archiveName, mirrorDownload, mirrorPage, mirrorRelease, offMirror, parseScriptPins, scriptEnabled, svnListing } from '../../scripts/third-party-lib.mjs'

const manifest = JSON.parse(readFileSync('vendor/manifest.json', 'utf8'))

describe('the third-party mirror', () => {
  it('names a release in this repo, and every vendor download comes from it', () => {
    expect(mirrorPage(manifest)).toMatch(/^https:\/\/github\.com\/ShriVarshaan\/video-player\/releases\/tag\/third-party-/)
    expect(offMirror(manifest)).toEqual([])
    for (const p of manifest.packages) expect(p.url).toBe(mirrorDownload(manifest, p.url.split('/').pop()))
  })

  it('reports a package that downloads from somewhere else', () => {
    const other = { ...manifest, packages: [...manifest.packages, { name: 'x', url: 'https://example.com/x.zip' }] }
    expect(offMirror(other)).toEqual(['x'])
  })

  it('pins the source of each binary to full commits', () => {
    for (const p of manifest.packages) {
      expect(p.sources.length).toBeGreaterThan(0)
      for (const s of p.sources) expect(s.commit).toMatch(/^[0-9a-f]{40}$/)
    }
  })
})

describe('mirrorRelease', () => {
  // Installed copies update from GitHub's "latest" release: this one must never become it.
  it('is a public pre-release that is never marked latest', () => {
    const r = mirrorRelease(manifest, 'notes', 'abc123')
    expect(r).toMatchObject({ tag_name: manifest.mirror.tag, target_commitish: 'abc123', body: 'notes', draft: false, prerelease: true, make_latest: 'false' })
    expect(r.name).toMatch(/third-party/i)
  })
})

describe('parseScriptPins', () => {
  it('reads every repo and commit pair, numbered or not', () => {
    const text = [
      '#!/bin/bash',
      'SCRIPT_REPO="https://git.savannah.gnu.org/git/libiconv.git"',
      'SCRIPT_MIRROR="git://git.git.savannah.gnu.org/libiconv.git"',
      'SCRIPT_COMMIT="b5a1735e02bf43ee6e490fcf9395e8abc8d32432"',
      'SCRIPT_REPO2="https://git.savannah.gnu.org/git/gnulib.git"',
      'SCRIPT_MIRROR2="https://github.com/coreutils/gnulib.git"',
      'SCRIPT_COMMIT2="5df606bbd0ef54a8f150c3303c870b9381a661f0"',
      'ffbuild_enabled() {',
      '    return 0',
      '}'
    ].join('\n')
    expect(parseScriptPins(text)).toEqual([
      { kind: 'git', repo: 'https://git.savannah.gnu.org/git/libiconv.git', ref: 'b5a1735e02bf43ee6e490fcf9395e8abc8d32432', mirror: 'git://git.git.savannah.gnu.org/libiconv.git' },
      { kind: 'git', repo: 'https://git.savannah.gnu.org/git/gnulib.git', ref: '5df606bbd0ef54a8f150c3303c870b9381a661f0', mirror: 'https://github.com/coreutils/gnulib.git' }
    ])
  })

  it('keeps tags, and reads svn revisions', () => {
    expect(parseScriptPins('SCRIPT_REPO="https://github.com/openssl/openssl.git"\nSCRIPT_COMMIT="openssl-3.6.5"\n')).toEqual([
      { kind: 'git', repo: 'https://github.com/openssl/openssl.git', ref: 'openssl-3.6.5' }
    ])
    expect(parseScriptPins('SCRIPT_REPO="https://svn.code.sf.net/p/lame/svn/trunk/lame"\nSCRIPT_REV="7113"\n')).toEqual([
      { kind: 'svn', repo: 'https://svn.code.sf.net/p/lame/svn/trunk/lame', ref: '7113' }
    ])
  })

  it('a script with nothing to download has no pins', () => {
    expect(parseScriptPins('SCRIPT_SKIP="1"\n')).toEqual([])
  })
})

describe('scriptEnabled', () => {
  const env = { target: 'win64', variant: 'lgpl-shared', addins: '9.0' }
  const script = (...lines: string[]) => `SCRIPT_REPO="x"\n\nffbuild_enabled() {\n${lines.map((l) => `    ${l}`).join('\n')}\n}\n`
  const on = (text: string, others: Record<string, string> = {}) => scriptEnabled(text, env, (p) => others[p] ?? '')

  it('reads the build target, variant and FFmpeg version checks', () => {
    expect(on(script('return 0'))).toBe(true)
    expect(on(script('[[ $VARIANT == lgpl* ]] && return -1', 'return 0'))).toBe(false)
    expect(on(script('[[ $VARIANT == nonfree* ]] || return -1', 'return 0'))).toBe(false)
    expect(on(script('[[ $TARGET != linux* ]] && return -1', 'return 0'))).toBe(false)
    expect(on(script('[[ $TARGET == win32 ]] && return -1', '[[ $TARGET == *arm64 ]] && return -1', 'return 0'))).toBe(true)
    expect(on(script('(( $(ffbuild_ffver) >= 700 )) || return -1', 'return 0'))).toBe(true)
    expect(on(script('(( $(ffbuild_ffver) <= 900 )) && return -1', 'return 0'))).toBe(false)
    expect(on(script('[[ $ADDINS_STR == *4.4* && $TARGET == win* ]] && return -1', 'return 0'))).toBe(true)
    expect(on(script('[[ $TARGET == winarm64 ]] && (( $(ffbuild_ffver) <= 801 )) && return -1', 'return 0'))).toBe(true)
    expect(on(script('return -1'))).toBe(false)
    // A bare test as the last line is the result.
    expect(on(script('[[ $TARGET == win* ]]'))).toBe(true)
    expect(on(script('[[ $TARGET == linux* ]]'))).toBe(false)
  })

  it('follows a check that defers to another script', () => {
    const text = script('( source scripts.d/50-rav1e.sh && ffbuild_enabled ) || return -1', 'return 0')
    expect(on(text, { 'scripts.d/50-rav1e.sh': script('return 0') })).toBe(true)
    expect(on(text, { 'scripts.d/50-rav1e.sh': script('return -1') })).toBe(false)
  })

  it('a line it cannot read keeps the library in: more source is never wrong', () => {
    expect(on(script('some_helper || return -1', 'return 0'))).toBe(true)
    expect(on('SCRIPT_REPO="x"\n')).toBe(true)
  })
})

describe('svnListing', () => {
  it("reads an svn server's revision page into files and folders, without the parent", () => {
    const html = `<html><head><title>p/lame/svn - Revision 7113: /trunk/lame</title></head><body><ul>
  <li><a href="../">..</a></li>
  <li><a href=".clang-format">.clang-format</a></li>
  <li><a href="ACM/">ACM/</a></li>
  <li><a href="Makefile%20x.am">Makefile x.am</a></li>
 </ul></body></html>`
    expect(svnListing(html)).toEqual([
      { name: '.clang-format', dir: false },
      { name: 'ACM', dir: true },
      { name: 'Makefile x.am', dir: false }
    ])
  })

  it('ignores names that would leave the folder', () => {
    expect(svnListing('<li><a href="../../x">x</a></li><li><a href="/abs">a</a></li><li><a href="a/../b">b</a></li>')).toEqual([])
  })
})

describe('archiveName', () => {
  it('names an archive after the repo and a short commit, or the whole tag', () => {
    expect(archiveName('https://github.com/libass/libass.git', 'f61db567e6593df3470e91594bcd4ad2d0473aff')).toBe('libass-f61db567e659.tar.gz')
    expect(archiveName('https://github.com/openssl/openssl.git', 'openssl-3.6.5')).toBe('openssl-openssl-3.6.5.tar.gz')
    expect(archiveName('https://svn.code.sf.net/p/lame/svn/trunk/lame', '7113')).toBe('lame-7113.tar.gz')
    expect(archiveName('https://github.com/KhronosGroup/Vulkan-Headers.git', 'v1.4.366')).toBe('Vulkan-Headers-v1.4.366.tar.gz')
  })
})

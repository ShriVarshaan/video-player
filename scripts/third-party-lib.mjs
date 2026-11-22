// The third-party mirror: one pre-release in this repo that holds the exact mpv and FFmpeg
// files Cinewall ships, and their source. Upstream builds get deleted (FFmpeg-Builds keeps
// a few weeks), so downloads and the GPL/LGPL source offer both point here. Pure helpers.

const releasesBase = (m) => `https://github.com/${m.mirror.repo}/releases`

export const mirrorPage = (m) => `${releasesBase(m)}/tag/${m.mirror.tag}`
export const mirrorDownload = (m, file) => `${releasesBase(m)}/download/${m.mirror.tag}/${file}`

// The GitHub release that holds the mirror. Installed copies update from the "latest" release,
// so this is a pre-release and never marked latest: otherwise every update check would fail.
export const mirrorRelease = (m, body, commit) => ({
  tag_name: m.mirror.tag,
  target_commitish: commit,
  name: `Third-party files: mpv and FFmpeg (${m.mirror.tag})`,
  body,
  draft: false,
  prerelease: true,
  make_latest: 'false'
})

// Names of the packages that don't download from the mirror.
export const offMirror = (m) => m.packages.filter((p) => !p.url.startsWith(`${releasesBase(m)}/download/${m.mirror.tag}/`)).map((p) => p.name)

// FFmpeg-Builds pins each library in scripts.d/*.sh as SCRIPT_REPO[n] + SCRIPT_COMMIT[n]
// (a commit or a tag), or SCRIPT_REV[n] for svn, with an optional SCRIPT_MIRROR[n].
export function parseScriptPins(text) {
  const vars = {}
  for (const m of text.matchAll(/^SCRIPT_([A-Z]+)(\d*)="([^"]*)"/gm)) vars[`${m[1]}${m[2]}`] = m[3]
  const pins = []
  for (const n of ['', '2', '3', '4', '5']) {
    const repo = vars[`REPO${n}`]
    if (!repo) continue
    const mirror = vars[`MIRROR${n}`]
    const pin = vars[`REV${n}`]
      ? { kind: 'svn', repo, ref: vars[`REV${n}`] }
      : vars[`COMMIT${n}`]
        ? { kind: 'git', repo, ref: vars[`COMMIT${n}`] }
        : null
    if (pin) pins.push(mirror ? { ...pin, mirror } : pin)
  }
  return pins
}

// Whether an FFmpeg-Builds script is part of a build, read from its ffbuild_enabled() as text:
// the scripts are never run. It knows the checks those scripts use ([[ $TARGET/$VARIANT/$ADDINS_STR
// == or != glob ]], (( $(ffbuild_ffver) op N )), deferring to another script). A line it can't read
// is skipped, which keeps the library in: mirroring more source than needed is harmless.
// readScript(path) gives another script's text, for the deferring check.
export function scriptEnabled(text, env, readScript, depth = 0) {
  const body = /^ffbuild_enabled\(\)\s*\{\n([\s\S]*?)^\}/m.exec(text)?.[1]
  if (body === undefined) return true
  const [major = '0', minor = '0'] = env.addins.split('.')
  const vars = { TARGET: env.target, VARIANT: env.variant, ADDINS_STR: env.addins }
  const ffver = Number(major) * 100 + Number(minor)
  const glob = (pattern) => new RegExp(`^${pattern.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`)
  const OPS = { '>': (a, b) => a > b, '>=': (a, b) => a >= b, '<': (a, b) => a < b, '<=': (a, b) => a <= b, '==': (a, b) => a === b }

  // One [[ … ]] or (( … )) test, or a deferral; null when it isn't one of those.
  const test = (t) => {
    let m = /^\[\[\s*(.+?)\s*\]\]$/.exec(t)
    if (m) {
      const parts = m[1].split(/\s*&&\s*/).map((p) => /^\$(\w+)\s*(==|!=)\s*(\S+)$/.exec(p))
      if (parts.some((p) => !p || !(p[1] in vars))) return null
      return parts.every((p) => glob(p[3]).test(vars[p[1]]) === (p[2] === '=='))
    }
    m = /^\(\(\s*\$\(ffbuild_ffver\)\s*(>=|<=|>|<|==)\s*(\d+)\s*\)\)$/.exec(t)
    if (m) return OPS[m[1]](ffver, Number(m[2]))
    m = /^\(\s*source\s+(\S+)\s*&&\s*ffbuild_enabled\s*\)$/.exec(t)
    if (m) return depth < 5 ? scriptEnabled(readScript(m[1]), env, readScript, depth + 1) : null
    return null
  }

  const lines = body.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
  for (const [i, line] of lines.entries()) {
    const ret = /^return\s+(-?\d+)$/.exec(line)
    if (ret) return ret[1] === '0'
    // cond1 && cond2 … (&& | ||) return N, or a bare chain of tests as the last line.
    const m = /^(.*?)\s*(&&|\|\|)\s*return\s+(-?\d+)$/.exec(line)
    const chain = (m ? m[1] : line).split(/\s+&&\s+(?=\[\[|\(\()/)
    const results = chain.map(test)
    if (results.includes(null)) continue
    const holds = results.every(Boolean)
    if (!m) {
      if (i === lines.length - 1) return holds
      continue
    }
    if ((m[2] === '&&') === holds) return m[3] === '0'
  }
  return true
}

// An svn server's plain HTTP page for one folder at one revision (…/!svn/bc/<rev>/<path>/).
// Only plain names one level down: anything that could leave the folder is dropped.
export function svnListing(html) {
  const entries = []
  for (const m of html.matchAll(/<li><a href="([^"]+)">/g)) {
    const dir = m[1].endsWith('/')
    const name = decodeURIComponent(dir ? m[1].slice(0, -1) : m[1])
    if (!name || name === '.' || name === '..' || /[/\\]/.test(name)) continue
    entries.push({ name, dir })
  }
  return entries
}

// <repo>-<12-char commit, or the whole tag or revision>.tar.gz
export function archiveName(repo, ref) {
  const name = repo.replace(/\/+$/, '').replace(/\.git$/, '').split('/').pop()
  const short = /^[0-9a-f]{40}$/.test(ref) ? ref.slice(0, 12) : ref
  return `${name}-${short.replace(/[^A-Za-z0-9._-]/g, '_')}.tar.gz`
}

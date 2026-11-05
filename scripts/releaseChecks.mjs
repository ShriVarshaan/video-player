// What must be true before a release, kept apart from release.mjs so it can be tested.

const escapeForRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// The changelog section for one version, without its heading; null when there's none or it's empty.
export function notesFor(changelog, version) {
  const text = changelog.replace(/\r\n/g, '\n')
  const heading = new RegExp(`^## \\[?${escapeForRegExp(version)}\\]?(?:\\s.*)?$`, 'm').exec(text)
  if (!heading) return null
  const rest = text.slice(heading.index + heading[0].length)
  const next = rest.search(/^## /m)
  const notes = (next === -1 ? rest : rest.slice(0, next)).trim()
  return notes || null
}

// Everything in the way of a release, in plain words. Empty when it can go ahead.
export function checkRelease(s) {
  const problems = []
  if (s.branch !== 'main') problems.push(`Releases are made from main, and this is ${s.branch}.`)
  if (s.dirty) problems.push('There are uncommitted changes.')
  if (s.head !== s.originMain) problems.push('This main is not the same as origin/main: pull or push first.')
  if (s.published.includes(s.version)) problems.push(`Version ${s.version} is already released: raise the version in package.json.`)
  if (!s.hasToken) problems.push('GH_TOKEN is not set: give it for this one command, and never save it to a file.')
  if (!notesFor(s.changelog, s.version)) problems.push(`CHANGELOG.md has no entry for ${s.version}.`)
  return problems
}

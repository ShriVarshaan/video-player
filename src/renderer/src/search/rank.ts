import Fuse from 'fuse.js'
import type { SearchDoc } from '@shared/library'
import { normalizeTitle } from '@shared/normalize'
import { parseQuery, type Scope } from './query'

// Titles first (the user usually knows the title): Fuse finds the candidates,
// then results are ordered by tier, and by Fuse score within a tier.
//   0 exact title · 1 title starts with it · 2 a word in the title starts with it · 3 the rest

type IndexedDoc = {
  doc: SearchDoc
  title: string
  originalTitle: string
  cast: string[]
  directors: string[]
  genres: string[]
  year: string
}
export type SearchIndex = { docs: IndexedDoc[]; fuse: Fuse<IndexedDoc> }

const ARTICLE = /^(the|a|an|le|la|les|l) /

export function buildIndex(docs: SearchDoc[]): SearchIndex {
  const indexed = docs.map(
    (d): IndexedDoc => ({
      doc: d,
      title: normalizeTitle(d.title),
      originalTitle: normalizeTitle(d.originalTitle ?? ''),
      cast: d.cast.map(normalizeTitle),
      directors: d.directors.map(normalizeTitle),
      genres: d.genres.map(normalizeTitle),
      year: d.year === null ? '' : String(d.year)
    })
  )
  const fuse = new Fuse(indexed, {
    keys: [
      { name: 'title', weight: 0.5 },
      { name: 'originalTitle', weight: 0.15 },
      { name: 'cast', weight: 0.15 },
      { name: 'directors', weight: 0.1 },
      { name: 'genres', weight: 0.05 },
      { name: 'year', weight: 0.05 }
    ],
    threshold: 0.35,
    ignoreLocation: true,
    minMatchCharLength: 2,
    includeScore: true
  })
  return { docs: indexed, fuse }
}

function tier(d: IndexedDoc, q: string): number {
  const forms = [d.title, d.originalTitle].filter(Boolean).flatMap((t) => [t, t.replace(ARTICLE, '')])
  if (forms.includes(q)) return 0
  if (forms.some((t) => t.startsWith(q))) return 1
  if (forms.some((t) => ` ${t}`.includes(` ${q}`))) return 2
  return 3
}

type Hit = { d: IndexedDoc; tier: number; score: number }

function ranked(index: SearchIndex, q: string): Hit[] {
  return index.fuse
    .search(q)
    .map((r) => ({ d: r.item, tier: tier(r.item, q), score: r.score ?? 1 }))
    .sort((a, b) => a.tier - b.tier || a.score - b.score)
}

// A scoped value matches a name when it is the whole name or whole words of it.
function nameMatches(name: string, value: string): boolean {
  if (name === value) return true
  const words = name.split(' ')
  return value.split(' ').every((w) => words.includes(w))
}

function scoped(index: SearchIndex, s: Scope): SearchDoc[] {
  const field = s.field === 'cast' ? 'cast' : s.field === 'director' ? 'directors' : 'genres'
  return index.docs
    .filter((d) => d[field].some((n) => nameMatches(n, s.value)))
    .sort((a, b) => a.title.localeCompare(b.title))
    .map((d) => d.doc)
}

export function search(index: SearchIndex, raw: string): SearchDoc[] {
  const p = parseQuery(raw)
  if (p.empty) return []
  if (p.scope) return scoped(index, p.scope)

  const text = ranked(index, p.text)
  if (p.year === null) return text.map((h) => h.d.doc)

  // A year is title text too ("1917", "2049"): strong title matches first,
  // then titles of that year matching the rest, then the loose text matches.
  const rest = p.text.split(' ').filter((w) => w !== String(p.year)).join(' ')
  const ofYear =
    rest.replace(/ /g, '').length >= 2
      ? ranked(index, rest).filter((h) => h.d.doc.year === p.year).map((h) => h.d)
      : index.docs.filter((d) => d.doc.year === p.year).sort((a, b) => a.title.localeCompare(b.title))
  const ordered = [...text.filter((h) => h.tier < 3).map((h) => h.d), ...ofYear, ...text.filter((h) => h.tier === 3).map((h) => h.d)]
  const seen = new Set<string>()
  return ordered.filter((d) => !seen.has(d.doc.key) && seen.add(d.doc.key)).map((d) => d.doc)
}

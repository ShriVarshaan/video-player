import { normalizeTitle } from '@shared/normalize'

// What the user typed, understood: folded free text, a year, or a scoped
// filter from a chip (cast:"Tom Hanks", director:"…", genre:Drama).

export type Scope = { field: 'cast' | 'director' | 'genre'; value: string } // value folded
// decade: a chip's '2010s' filters to 2010–2019.
export type ParsedQuery = { text: string; year: number | null; decade: number | null; scope: Scope | null; empty: boolean }

// Matching starts at 2 letters or digits; shorter shows the empty-state rows.
const MIN_CHARS = 2
const SCOPED = /^(cast|director|genre):\s*(?:"([^"]*)"?|(.*))$/i
const YEAR = /^(19|20)\d\d$/
const DECADE = /^((?:19|20)\d0)s$/i

export function parseQuery(raw: string): ParsedQuery {
  const trimmed = raw.trim()
  const scoped = SCOPED.exec(trimmed)
  if (scoped) {
    const value = normalizeTitle(scoped[2] ?? scoped[3] ?? '')
    const field = scoped[1]!.toLowerCase() as Scope['field']
    return { text: '', year: null, decade: null, scope: { field, value }, empty: value.length === 0 }
  }
  const decade = DECADE.exec(trimmed)
  if (decade) return { text: '', year: null, decade: Number(decade[1]), scope: null, empty: false }
  const text = normalizeTitle(trimmed)
  const year = text.split(' ').find((w) => YEAR.test(w))
  return { text, year: year ? Number(year) : null, decade: null, scope: null, empty: text.replace(/ /g, '').length < MIN_CHARS }
}

// The query a chip puts in the box: quoted when the name has spaces.
export function scopedQuery(field: Scope['field'], value: string): string {
  return `${field}:${/\s/.test(value) ? `"${value}"` : value}`
}

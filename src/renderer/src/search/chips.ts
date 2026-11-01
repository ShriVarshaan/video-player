import type { SearchDoc } from '@shared/library'
import { normalizeTitle } from '@shared/normalize'
import { scopedQuery } from './query'

// "Explore titles related to:" chips, and genre chips for the no-match state.

export type Chip = { label: string; query: string }

const MAX_RELATED = 5
const FROM_TOP = 12
const TOP_CAST = 3
const MAX_GENRES = 6

const byCount = (counts: Map<string, { chip: Chip; n: number }>) =>
  [...counts.values()].sort((a, b) => b.n - a.n || a.chip.label.localeCompare(b.chip.label)).map((c) => c.chip)

function add(counts: Map<string, { chip: Chip; n: number }>, chip: Chip) {
  const cur = counts.get(chip.query)
  if (cur) cur.n++
  else counts.set(chip.query, { chip, n: 1 })
}

export function relatedChips(results: SearchDoc[], raw: string): Chip[] {
  const q = normalizeTitle(raw)
  const counts = new Map<string, { chip: Chip; n: number }>()
  for (const d of results.slice(0, FROM_TOP)) {
    for (const g of d.genres) add(counts, { label: g, query: scopedQuery('genre', g) })
    for (const p of d.directors) add(counts, { label: p, query: scopedQuery('director', p) })
    for (const p of d.cast.slice(0, TOP_CAST)) add(counts, { label: p, query: scopedQuery('cast', p) })
    if (d.year !== null) {
      const decade = `${Math.floor(d.year / 10) * 10}s`
      add(counts, { label: decade, query: decade })
    }
  }
  return byCount(counts)
    .filter((c) => normalizeTitle(c.label) !== q)
    .slice(0, MAX_RELATED)
}

export function libraryGenreChips(docs: SearchDoc[]): Chip[] {
  const counts = new Map<string, { chip: Chip; n: number }>()
  for (const d of docs) for (const g of d.genres) add(counts, { label: g, query: scopedQuery('genre', g) })
  return byCount(counts).slice(0, MAX_GENRES)
}

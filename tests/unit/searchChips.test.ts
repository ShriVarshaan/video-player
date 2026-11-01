import { describe, expect, it } from 'vitest'
import type { SearchDoc } from '@shared/library'
import { libraryGenreChips, relatedChips } from '../../src/renderer/src/search/chips'
import { moveInGrid } from '../../src/renderer/src/search/gridNav'
import { emptyRows } from '../../src/renderer/src/search/rows'

let n = 0
function doc(title: string, extra: Partial<SearchDoc> = {}): SearchDoc {
  n++
  return {
    key: `movie:${n}`, kind: 'movie', order: n, title, year: null, posterUrl: '', backdropUrl: null, matched: true,
    runtimeMin: null, seasonCount: null, episodeCount: null, genres: [], rating: null, overview: null, progress: null,
    playLabel: 'Play', originalTitle: null, cast: [], directors: [], logoUrl: null, addedAt: 0, lastPlayedAt: null,
    inProgress: false, ...extra
  }
}
const NOLAN = 'Christopher Nolan'
const nolan = [
  doc('Inception', { year: 2010, directors: [NOLAN], cast: ['Leonardo DiCaprio', 'Tom Hardy', 'Elliot Page', 'Michael Caine'], genres: ['Science Fiction', 'Action'] }),
  doc('Interstellar', { year: 2014, directors: [NOLAN], cast: ['Matthew McConaughey', 'Anne Hathaway', 'Jessica Chastain', 'Michael Caine'], genres: ['Science Fiction', 'Drama'] }),
  doc('Tenet', { year: 2020, directors: [NOLAN], cast: ['John David Washington'], genres: ['Action'] })
]

describe('relatedChips', () => {
  it('counts genres, people and decade from the top 12', () => {
    const chips = relatedChips(nolan, 'nolan')
    expect(chips.length).toBeLessThanOrEqual(5)
    expect(chips).toContainEqual({ label: NOLAN, query: 'director:"Christopher Nolan"' })
    expect(chips).toContainEqual({ label: '2010s', query: '2010s' })
    expect(chips).toContainEqual({ label: 'Science Fiction', query: 'genre:"Science Fiction"' })
  })

  it('skips the query itself', () => {
    expect(relatedChips(nolan, 'christopher nolan').map((c) => c.label)).not.toContain(NOLAN)
    expect(relatedChips(nolan, 'nolan').map((c) => c.label)).toContain(NOLAN)
  })

  it('only the top 3 cast count', () => {
    // Michael Caine is 4th billed in both films: never a chip.
    expect(relatedChips(nolan, 'x').map((c) => c.label)).not.toContain('Michael Caine')
  })

  it('no results, no chips', () => {
    expect(relatedChips([], 'zzz')).toEqual([])
  })
})

describe('libraryGenreChips', () => {
  it('the 6 most common genres, ties alphabetical', () => {
    const lib = [
      doc('a', { genres: ['Drama', 'Comedy'] }), doc('b', { genres: ['Drama', 'War'] }), doc('c', { genres: ['Drama', 'Comedy'] }),
      doc('d', { genres: ['Horror', 'Action', 'Western', 'Crime'] })
    ]
    expect(libraryGenreChips(lib).map((c) => c.label)).toEqual(['Drama', 'Comedy', 'Action', 'Crime', 'Horror', 'War'])
    expect(libraryGenreChips(lib)[0]).toEqual({ label: 'Drama', query: 'genre:Drama' })
  })
})

describe('emptyRows', () => {
  it('Continue watching by last played, Recently added by date, each capped at 12', () => {
    const lib = Array.from({ length: 20 }, (_, i) => doc(`t${i}`, { addedAt: i, inProgress: i % 2 === 0, lastPlayedAt: i % 2 === 0 ? 100 - i : null }))
    const rows = emptyRows(lib)
    expect(rows.map((r) => r.title)).toEqual(['Continue watching', 'Recently added'])
    expect(rows[0]!.docs.map((d) => d.title)).toEqual(['t0', 't2', 't4', 't6', 't8', 't10', 't12', 't14', 't16', 't18'])
    expect(rows[1]!.docs).toHaveLength(12)
    expect(rows[1]!.docs[0]!.title).toBe('t19')
  })

  it('leaves out empty rows', () => {
    expect(emptyRows([doc('a')]).map((r) => r.title)).toEqual(['Recently added'])
    expect(emptyRows([])).toEqual([])
  })
})

describe('moveInGrid', () => {
  it('moves by cell in a 4-column grid of 10', () => {
    expect(moveInGrid(3, 'ArrowRight', 4, 10)).toBe(4)
    expect(moveInGrid(1, 'ArrowDown', 4, 10)).toBe(5)
    expect(moveInGrid(9, 'ArrowDown', 4, 10)).toBe(9)
    expect(moveInGrid(6, 'ArrowDown', 4, 10)).toBe(9)
    expect(moveInGrid(2, 'ArrowUp', 4, 10)).toBe('up-out')
    expect(moveInGrid(5, 'ArrowUp', 4, 10)).toBe(1)
    expect(moveInGrid(0, 'ArrowLeft', 4, 10)).toBe(0)
    expect(moveInGrid(9, 'ArrowRight', 4, 10)).toBe(9)
  })
})

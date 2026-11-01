import { describe, expect, it } from 'vitest'
import type { SearchDoc } from '@shared/library'
import { parseQuery, scopedQuery } from '../../src/renderer/src/search/query'
import { buildIndex, search } from '../../src/renderer/src/search/rank'

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
const docs = [
  doc('Prince of Persia', { year: 2010, genres: ['Adventure'] }),
  doc('Interstellar', { year: 2014, directors: [NOLAN], genres: ['Science Fiction'] }),
  doc('The Incredibles', { year: 2004, genres: ['Animation'] }),
  doc('Inception', { year: 2010, directors: [NOLAN], cast: ['Leonardo DiCaprio'], genres: ['Science Fiction', 'Action'] }),
  doc('The Matrix Reloaded', { year: 2003, cast: ['Keanu Reeves'] }),
  doc('The Matrix', { year: 1999, cast: ['Keanu Reeves'], genres: ['Science Fiction'] }),
  doc('1917', { year: 2019, genres: ['War'] }),
  doc('Blade Runner 2049', { year: 2017 }),
  doc('Amélie', { year: 2001, originalTitle: 'Le Fabuleux Destin d’Amélie Poulain', cast: ['Audrey Tautou'], genres: ['Comedy'] }),
  doc('The Dark Knight', { year: 2008, directors: [NOLAN] }),
  doc('Tomb Raider', { year: 2018 }),
  doc('Cast Away', { year: 2000, cast: ['Tom Hanks'], genres: ['Drama'] }),
  doc('Breaking Bad', { key: 'tmdb:1396', kind: 'show', year: 2008, directors: ['Vince Gilligan'], cast: ['Bryan Cranston'], genres: ['Drama'] }),
  doc('Some Unknown Home Video', { matched: false })
]
const idx = buildIndex(docs)
const titles = (q: string) => search(idx, q).map((d) => d.title)
const pos = (q: string, t: string) => titles(q).indexOf(t)

describe('search ranking', () => {
  it('exact title first', () => {
    expect(titles('inception')[0]).toBe('Inception')
  })

  it('prefix beats contains', () => {
    expect(pos('inc', 'Inception')).toBeLessThan(pos('inc', 'Prince of Persia'))
    expect(pos('inc', 'The Incredibles')).toBeLessThan(pos('inc', 'Prince of Persia'))
    expect(pos('inc', 'Prince of Persia')).toBeGreaterThanOrEqual(0)
  })

  it('leading article ignored', () => {
    expect(titles('matrix').slice(0, 2)).toEqual(['The Matrix', 'The Matrix Reloaded'])
  })

  it('word start', () => {
    expect(titles('knight')[0]).toBe('The Dark Knight')
  })

  it('typo', () => {
    expect(titles('incepton')[0]).toBe('Inception')
  })

  it('accents', () => {
    expect(titles('amelie')[0]).toBe('Amélie')
  })

  it('people', () => {
    expect(titles('nolan').slice(0, 3).sort()).toEqual(['Inception', 'Interstellar', 'The Dark Knight'])
    expect(titles('hanks')[0]).toBe('Cast Away')
  })

  it('titles beat people', () => {
    expect(pos('tom', 'Tomb Raider')).toBeLessThan(pos('tom', 'Cast Away'))
    expect(pos('tom', 'Cast Away')).toBeGreaterThanOrEqual(0)
  })

  it('numbers are titles and years', () => {
    expect(titles('1917')[0]).toBe('1917')
    expect(titles('2049')[0]).toBe('Blade Runner 2049')
    expect(titles('matrix 1999')[0]).toBe('The Matrix')
    expect(titles('1999')).toContain('The Matrix')
  })

  it('scoped queries', () => {
    expect(titles('cast:"Audrey Tautou"')).toEqual(['Amélie'])
    expect(titles('genre:drama').sort()).toEqual(['Breaking Bad', 'Cast Away'])
    expect(titles('genre:science fiction').sort()).toEqual(['Inception', 'Interstellar', 'The Matrix'])
    expect(titles('director:"Vince Gilligan"')).toEqual(['Breaking Bad'])
    expect(titles('director:nolan').sort()).toEqual(['Inception', 'Interstellar', 'The Dark Knight'])
    expect(titles('genre:dram')).toEqual([]) // whole words only, not fuzzy
    expect(titles(`director:"${NOLAN}"`).sort()).toEqual(['Inception', 'Interstellar', 'The Dark Knight'])
    expect(titles('cast:"Nobody Here"')).toEqual([])
  })

  it('blank and punctuation-only queries are empty', () => {
    for (const q of ['   ', '?', '"', 'a', '']) {
      expect(() => search(idx, q)).not.toThrow()
      expect(search(idx, q)).toEqual([])
    }
    expect(parseQuery('  ').empty).toBe(true)
    expect(parseQuery('cast:').empty).toBe(true)
  })

  it('finds an unmatched file by its parsed title', () => {
    expect(titles('home video')[0]).toBe('Some Unknown Home Video')
  })

  it('scopedQuery quotes names with spaces', () => {
    expect(scopedQuery('cast', 'Tom Hanks')).toBe('cast:"Tom Hanks"')
    expect(scopedQuery('genre', 'Drama')).toBe('genre:Drama')
    expect(parseQuery('cast:"Tom Hanks"').scope).toEqual({ field: 'cast', value: 'tom hanks' })
  })
})

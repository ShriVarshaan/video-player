import { describe, expect, it } from 'vitest'
import { pickBest } from '../../src/main/metadata/score'

const c = (id: number, title: string, year: number | null, popularity = 10) => ({ id, title, year, popularity })

describe('pickBest', () => {
  it('prefers the exact title and year', () => {
    const best = pickBest({ title: 'The Matrix', year: 1999 }, [
      c(604, 'The Matrix Reloaded', 2003, 50),
      c(603, 'The Matrix', 1999, 80),
      c(624860, 'The Matrix Resurrections', 2021, 90)
    ])
    expect(best?.id).toBe(603)
  })

  it('ignores case, separators and accents', () => {
    expect(pickBest({ title: 'inception', year: 2010 }, [c(27205, 'Inception', 2010)])?.id).toBe(27205)
    expect(pickBest({ title: 'Amélie', year: 2001 }, [c(194, 'Amélie', 2001)])?.id).toBe(194)
  })

  it('rejects a weak title match', () => {
    expect(pickBest({ title: 'Some Unknown Home Video', year: null }, [c(1, 'Home', 2010)])).toBeNull()
  })

  it('rejects a year more than one off', () => {
    expect(pickBest({ title: 'The Matrix', year: 1999 }, [c(9, 'The Matrix', 2010)])).toBeNull()
    expect(pickBest({ title: 'The Matrix', year: 1999 }, [c(603, 'The Matrix', 2000)])?.id).toBe(603)
  })

  it('accepts any year when the file has none', () => {
    expect(pickBest({ title: 'Breaking Bad', year: null }, [c(1396, 'Breaking Bad', 2008)])?.id).toBe(1396)
  })

  it('breaks ties on popularity', () => {
    expect(pickBest({ title: 'Dune', year: null }, [c(1, 'Dune', 1984, 20), c(2, 'Dune', 2021, 90)])?.id).toBe(2)
  })

  it('matches non-Latin titles by their letters, and never matches an empty title', () => {
    expect(pickBest({ title: 'Брат', year: 1997 }, [c(1, 'Брат 2', 2000), c(2, 'Брат', 1997)])?.id).toBe(2)
    expect(pickBest({ title: '!!!', year: null }, [c(3, '???', null)])).toBeNull()
  })

  it('returns null with no candidates', () => {
    expect(pickBest({ title: 'x', year: null }, [])).toBeNull()
  })
})

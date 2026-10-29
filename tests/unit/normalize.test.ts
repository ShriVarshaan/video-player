import { describe, expect, it } from 'vitest'
import { normalizeTitle } from '@shared/normalize'

describe('normalizeTitle', () => {
  it('folds accents, case, ampersands and punctuation', () => {
    expect(normalizeTitle('Amélie & Co.: The—Movie!')).toBe('amelie and co the movie')
  })

  it('keeps letters from every script', () => {
    expect(normalizeTitle('Брат 2')).toBe('брат 2')
    expect(normalizeTitle('千と千尋の神隠し')).toBe('千と千尋の神隠し')
    expect(normalizeTitle('Ελληνικά!')).toBe('ελληνικα')
  })

  it('collapses separators and trims', () => {
    expect(normalizeTitle('  The.Matrix__Reloaded  ')).toBe('the matrix reloaded')
  })
})

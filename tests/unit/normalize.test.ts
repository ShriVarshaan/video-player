import { describe, expect, it } from 'vitest'
import { normalizeTitle } from '@shared/normalize'

describe('normalizeTitle', () => {
  it('folds accents, case, ampersands and punctuation', () => {
    expect(normalizeTitle('Amélie & Co.: The—Movie!')).toBe('amelie and co the movie')
  })

  it('collapses separators and trims', () => {
    expect(normalizeTitle('  The.Matrix__Reloaded  ')).toBe('the matrix reloaded')
  })
})

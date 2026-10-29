import { describe, expect, it } from 'vitest'
import { firstSentence } from '../../src/renderer/src/wall/text'

describe('firstSentence', () => {
  it('cuts at the first sentence end', () => {
    expect(firstSentence('Walt cooks. Jesse sells.')).toBe('Walt cooks.')
  })

  it('does not stop at common abbreviations or initials', () => {
    expect(firstSentence('Dr. Alan Grant visits a park. It goes badly.')).toBe('Dr. Alan Grant visits a park.')
    expect(firstSentence('Mr. and Mrs. Smith are spies. Both lie.')).toBe('Mr. and Mrs. Smith are spies.')
    expect(firstSentence('J. R. Ewing schemes in the U.S. oil trade. Again.')).toBe('J. R. Ewing schemes in the U.S. oil trade.')
  })

  it('keeps text without a sentence end', () => {
    expect(firstSentence('No full stop here')).toBe('No full stop here')
  })
})

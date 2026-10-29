import { describe, expect, it } from 'vitest'
import { chooseStride, itemIndex, mod } from '../../src/renderer/src/wall/mapping'

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))
const strideCanSeparate = (n: number) => Array.from({ length: n }, (_, s) => s).some((s) => ![0, 1, n - 1].includes(s % n))

describe('mod', () => {
  it('wraps negatives into [0, n)', () => {
    expect(mod(-1, 5)).toBe(4)
    expect(mod(-10, 5)).toBe(0)
    expect(mod(7, 5)).toBe(2)
  })
})

describe('chooseStride', () => {
  it('uses 1 for tiny libraries', () => {
    expect([1, 2, 3].map(chooseStride)).toEqual([1, 1, 1])
  })

  it('keeps every neighbour different whenever a stride allows it', () => {
    for (let n = 1; n <= 60; n++) {
      const s = chooseStride(n)
      for (let row = -6; row < 6; row++) {
        for (let col = -6; col < 6; col++) {
          const here = itemIndex(col, row, n, s)
          expect(here).toBeGreaterThanOrEqual(0)
          expect(here).toBeLessThan(n)
          if (n > 1) expect(itemIndex(col + 1, row, n, s), `n=${n} horizontal`).not.toBe(here)
          if (n >= 4 && strideCanSeparate(n)) {
            expect(itemIndex(col, row + 1, n, s), `n=${n} vertical`).not.toBe(here)
            expect(itemIndex(col + 1, row + 1, n, s), `n=${n} diagonal`).not.toBe(here)
            expect(itemIndex(col - 1, row + 1, n, s), `n=${n} anti-diagonal`).not.toBe(here)
          }
        }
      }
    }
  })

  it('prefers a stride coprime with n', () => {
    for (let n = 5; n <= 60; n++) {
      const coprimeExists = Array.from({ length: n }, (_, s) => s).some((s) => s >= 2 && s <= n - 2 && gcd(s, n) === 1)
      if (coprimeExists) expect(gcd(chooseStride(n), n), `n=${n}`).toBe(1)
    }
  })
})

import { describe, expect, it } from 'vitest'
import { chooseStride, itemIndex, mod, nearestCell } from '../../src/renderer/src/wall/mapping'

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

describe('nearestCell', () => {
  it('finds the closest cell showing an item, even far outside the screen', () => {
    for (const n of [7, 60, 200]) {
      const s = chooseStride(n)
      for (const index of [0, 3, n - 1]) {
        const from = { col: 5, row: -2 }
        const cell = nearestCell(index, from, n, s)
        expect(itemIndex(cell.col, cell.row, n, s)).toBe(index)
        // Brute force over a wide window agrees on the distance.
        let best = Infinity
        for (let r = -40; r <= 40; r++) for (let c = -250; c <= 250; c++) {
          if (itemIndex(c, r, n, s) === index) best = Math.min(best, Math.hypot(c - from.col, r - from.row))
        }
        expect(Math.hypot(cell.col - from.col, cell.row - from.row)).toBeCloseTo(best, 6)
      }
    }
  })

  it('stays put when the cell already shows the item', () => {
    const s = chooseStride(9)
    const from = { col: 2, row: 3 }
    expect(nearestCell(itemIndex(2, 3, 9, s), from, 9, s)).toEqual(from)
  })
})

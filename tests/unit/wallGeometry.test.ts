import { describe, expect, it } from 'vitest'
import { assignSlots, poolSize, tileSize, visibleRange, type Cell } from '../../src/renderer/src/wall/geometry'

const cellsIn = (r: { c0: number; c1: number; r0: number; r1: number }) => (r.c1 - r.c0 + 1) * (r.r1 - r.r0 + 1)

describe('tileSize', () => {
  it('clamps width between 150 and 260 px at 11 % of the viewport', () => {
    expect(tileSize(1000).w).toBe(150)
    expect(tileSize(2000).w).toBe(220)
    expect(tileSize(4000).w).toBe(260)
  })

  it('is 2:3 with a gap of 0.9 × the width', () => {
    expect(tileSize(2000)).toEqual({ w: 220, h: 330, pitchX: 418, pitchY: 528 })
  })
})

describe('visibleRange', () => {
  it('covers the viewport plus one tile on every side, for negative cameras too', () => {
    const t = tileSize(2000)
    expect(visibleRange({ x: -1000, y: -50 }, 1920, 1080, t)).toEqual({
      c0: Math.floor((-1000 - t.pitchX) / t.pitchX),
      c1: Math.floor((-1000 + 1920 + t.pitchX) / t.pitchX),
      r0: Math.floor((-50 - t.pitchY) / t.pitchY),
      r1: Math.floor((-50 + 1080 + t.pitchY) / t.pitchY)
    })
  })
})

describe('poolSize', () => {
  it('always has a slot for every visible cell', () => {
    for (const [vw, vh] of [[3840, 2160], [1280, 720], [800, 600]] as const) {
      const t = tileSize(vw)
      const size = poolSize(vw, vh, t)
      for (let i = 0; i < 200; i++) {
        const cam = { x: (i * 137.3) % 5000 - 2500, y: (i * 91.7) % 5000 - 2500 }
        expect(cellsIn(visibleRange(cam, vw, vh, t))).toBeLessThanOrEqual(size)
      }
    }
  })
})

describe('assignSlots', () => {
  const key = (c: Cell) => `${c.col},${c.row}`

  it('gives every visible cell exactly one slot', () => {
    const range = { c0: 0, c1: 4, r0: 0, r1: 2 }
    const { assign, changed } = assignSlots(new Map(), range, 20)
    const cells = [...assign.values()].map(key)
    expect(new Set(cells).size).toBe(15)
    expect(changed).toHaveLength(15)
  })

  it('only reassigns slots for the column that scrolled in', () => {
    const first = assignSlots(new Map(), { c0: 0, c1: 4, r0: 0, r1: 2 }, 20)
    const next = assignSlots(first.assign, { c0: 1, c1: 5, r0: 0, r1: 2 }, 20)
    expect(next.changed).toHaveLength(3)
    for (const slot of next.changed) expect(next.assign.get(slot)!.col).toBe(5)
    const cells = [...next.assign.values()].map(key)
    expect(new Set(cells).size).toBe(15)
    for (let c = 1; c <= 5; c++) for (let r = 0; r <= 2; r++) expect(cells).toContain(`${c},${r}`)
  })
})

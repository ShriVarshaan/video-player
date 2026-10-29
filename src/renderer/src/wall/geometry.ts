// Tile sizes, the visible window and which pooled slot shows which cell.

export type TileSize = { w: number; h: number; pitchX: number; pitchY: number }
export type Range = { c0: number; c1: number; r0: number; r1: number }
export type Cell = { col: number; row: number }

export function tileSize(viewportW: number): TileSize {
  const w = Math.round(Math.min(260, Math.max(150, viewportW * 0.11)))
  const h = Math.round(w * 1.5)
  const gap = Math.round(w * 0.9)
  return { w, h, pitchX: w + gap, pitchY: h + gap }
}

// The cells the camera can see, plus one tile of buffer on every side.
export function visibleRange(cam: { x: number; y: number }, vw: number, vh: number, t: TileSize): Range {
  return {
    c0: Math.floor((cam.x - t.pitchX) / t.pitchX),
    c1: Math.floor((cam.x + vw + t.pitchX) / t.pitchX),
    r0: Math.floor((cam.y - t.pitchY) / t.pitchY),
    r1: Math.floor((cam.y + vh + t.pitchY) / t.pitchY)
  }
}

// Enough slots for the largest range visibleRange can return at this size.
export function poolSize(vw: number, vh: number, t: TileSize): number {
  const cols = Math.floor(vw / t.pitchX) + 4
  const rows = Math.floor(vh / t.pitchY) + 4
  return cols * rows
}

const cellKey = (col: number, row: number) => `${col},${row}`

// Slots whose cell is still visible keep it; only the freed slots take the new cells.
export function assignSlots(
  prev: Map<number, Cell>,
  range: Range,
  slotCount: number
): { assign: Map<number, Cell>; changed: number[] } {
  const inRange = (c: Cell) => c.col >= range.c0 && c.col <= range.c1 && c.row >= range.r0 && c.row <= range.r1
  const assign = new Map<number, Cell>()
  const taken = new Set<string>()
  for (const [slot, cell] of prev) {
    if (slot < slotCount && inRange(cell)) {
      assign.set(slot, cell)
      taken.add(cellKey(cell.col, cell.row))
    }
  }
  const free: number[] = []
  for (let s = 0; s < slotCount; s++) if (!assign.has(s)) free.push(s)
  const changed: number[] = []
  for (let row = range.r0; row <= range.r1; row++) {
    for (let col = range.c0; col <= range.c1; col++) {
      if (taken.has(cellKey(col, row))) continue
      const slot = free.shift()
      if (slot === undefined) return { assign, changed }
      assign.set(slot, { col, row })
      changed.push(slot)
    }
  }
  return { assign, changed }
}

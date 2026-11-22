import type { PipEdge } from '@shared/player'

// Where the floating (picture in picture) window goes, and how it moves and resizes.
// Always 16:9; sizes are in screen DIPs like Electron's bounds.
export type Rect = { x: number; y: number; width: number; height: number }

export const PIP_SIZE = { width: 480, height: 270 }
export const PIP_MARGIN = 24
export const PIP_MIN_WIDTH = 320

const heightFor = (width: number) => Math.round((width * 9) / 16)
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

// Bottom right of the work area, PIP_MARGIN in from the edges.
export function defaultPipBounds(workArea: Rect): Rect {
  return {
    x: workArea.x + workArea.width - PIP_MARGIN - PIP_SIZE.width,
    y: workArea.y + workArea.height - PIP_MARGIN - PIP_SIZE.height,
    ...PIP_SIZE
  }
}

const inside = (r: Rect, a: Rect) => r.x >= a.x && r.y >= a.y && r.x + r.width <= a.x + a.width && r.y + r.height <= a.y + a.height

// The remembered spot while it is wholly on some display, else the default corner of `current`.
export function pipBounds(saved: Rect | null, workAreas: Rect[], current: Rect): Rect {
  if (saved && workAreas.some((a) => inside(saved, a))) return saved
  return defaultPipBounds(current)
}

export function movePip(start: Rect, dx: number, dy: number, workArea: Rect): Rect {
  return {
    ...start,
    x: clamp(start.x + dx, workArea.x, workArea.x + workArea.width - start.width),
    y: clamp(start.y + dy, workArea.y, workArea.y + workArea.height - start.height)
  }
}

// Resizes from an edge or corner, keeping 16:9 and the opposite side where it is.
// A corner follows whichever axis moved more.
export function resizePip(start: Rect, edge: PipEdge, dx: number, dy: number, workArea: Rect): Rect {
  const sx = edge.includes('e') ? 1 : edge.includes('w') ? -1 : 0
  const sy = edge.includes('s') ? 1 : edge.includes('n') ? -1 : 0
  const candidates: number[] = []
  if (sx) candidates.push(start.width + sx * dx)
  if (sy) candidates.push(((start.height + sy * dy) * 16) / 9)
  const proposed = candidates.reduce((a, b) => (Math.abs(b - start.width) > Math.abs(a - start.width) ? b : a))
  const width = Math.round(clamp(proposed, PIP_MIN_WIDTH, Math.max(PIP_MIN_WIDTH, workArea.width)))
  const height = heightFor(width)
  return {
    x: sx < 0 ? start.x + start.width - width : start.x,
    y: sy < 0 ? start.y + start.height - height : start.y,
    width,
    height
  }
}

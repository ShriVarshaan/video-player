import type { CSSProperties } from 'react'
import type { FontId, SubtitleStyle } from '@shared/subtitleStyle'

// Pure layout and style maths for SubtitleView, unit-tested in Node.

const MARGIN = 0.04 // of the window height, at the bottom and the top
const GAP = 8 // px between a lifted line and the control bar

// Pixels from the window's bottom edge to the bottom of the subtitle block.
// position 0 sits on the bottom margin, 100 puts the block's top on the top margin.
export function subtitleBottom(p: { position: number; windowH: number; blockH: number; controlsTop: number | null; top: boolean }): number {
  const m = MARGIN * p.windowH
  const highest = p.windowH - m - p.blockH
  if (p.top) return highest
  const base = m + (p.position / 100) * (p.windowH - 2 * m - p.blockH)
  if (p.controlsTop !== null) {
    const clear = p.windowH - p.controlsTop + GAP
    if (base < clear) return clear
  }
  return base
}

const FAMILIES: Record<FontId, string> = {
  default: '"Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif',
  arial: 'Arial, sans-serif',
  georgia: 'Georgia, serif',
  courier: '"Courier New", monospace',
  consolas: 'Consolas, monospace',
  trebuchet: '"Trebuchet MS", sans-serif',
  casual: '"Comic Sans MS", cursive',
  cursive: '"Segoe Script", cursive',
  smallCaps: '"Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif'
}

export function rgba(hex: string, opacity: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${opacity / 100})`
}

const OUTLINE = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
  [-0.7, -0.7],
  [0.7, -0.7],
  [-0.7, 0.7],
  [0.7, 0.7]
]
  .map(([x, y]) => `${(x! * 0.06).toFixed(3).replace(/\.?0+$/, '')}em ${(y! * 0.06).toFixed(3).replace(/\.?0+$/, '')}em 0 rgba(0, 0, 0, 0.95)`)
  .join(', ')

const EDGE_SHADOWS: Record<SubtitleStyle['edge'], string> = {
  none: 'none',
  dropShadow: '0 0.05em 0.18em rgba(0, 0, 0, 0.75), 0 0 0.06em rgba(0, 0, 0, 0.6)',
  raised: '-0.03em -0.03em 0 rgba(255, 255, 255, 0.35), 0.04em 0.04em 0 rgba(0, 0, 0, 0.9)',
  depressed: '0.03em 0.03em 0 rgba(255, 255, 255, 0.35), -0.04em -0.04em 0 rgba(0, 0, 0, 0.9)',
  outline: OUTLINE
}

export type SubtitleCss = CSSProperties & { '--sub-line-bg': string; '--sub-window-bg': string }

export function styleToCss(s: SubtitleStyle, windowH: number): SubtitleCss {
  const px = Math.max(18, 0.045 * windowH) * (s.size / 100)
  return {
    fontFamily: FAMILIES[s.font],
    fontVariant: s.font === 'smallCaps' ? 'small-caps' : 'normal',
    fontSize: `${Math.round(px * 100) / 100}px`,
    color: rgba(s.textColor, s.textOpacity),
    textShadow: EDGE_SHADOWS[s.edge],
    '--sub-line-bg': rgba(s.backgroundColor, s.backgroundOpacity),
    '--sub-window-bg': rgba(s.windowColor, s.windowOpacity)
  }
}

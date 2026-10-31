// Subtitle timing shared by main and the overlay. Displayed time = scale * t + offset;
// a positive offset shows subtitles later. Manual sync only changes the offset.

export const MAX_OFFSET_S = 600
export const NUDGE_S = 0.05
export const NUDGE_BIG_S = 0.5
// Taken off "press S when you hear it": people press a little after the line starts.
export const REACTION_LEAD_S = 0

export function clampOffset(s: number): number {
  const c = Math.min(MAX_OFFSET_S, Math.max(-MAX_OFFSET_S, s))
  return Math.round(c * 1000) / 1000 || 0
}

// The offset that makes a cue starting at cueStart begin at positionS.
export const offsetForCue = (cueStart: number, positionS: number): number => clampOffset(positionS - REACTION_LEAD_S - cueStart)

// The first cue still to come with the current offset; the last one past the end; -1 with none.
export function firstCueAfter(starts: number[], offset: number, positionS: number): number {
  if (!starts.length) return -1
  const i = starts.findIndex((s) => s + offset > positionS)
  return i < 0 ? starts.length - 1 : i
}

export function formatOffset(s: number): string {
  const r = Math.round(s * 100) / 100
  if (r === 0) return 'in sync'
  return `${r > 0 ? '+' : '−'}${Math.abs(r).toFixed(2)} s`
}

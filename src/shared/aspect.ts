// Aspect ratios for the player's C key: VLC's list, in VLC's order, between two visits
// to the file's own ratio (null).

export const ASPECT_RATIOS = ['16:9', '4:3', '1:1', '16:10', '2.21:1', '2.35:1', '2.39:1', '5:4'] as const
export type AspectRatio = (typeof ASPECT_RATIOS)[number]

export function nextAspect(current: AspectRatio | null): AspectRatio | null {
  if (current === null) return ASPECT_RATIOS[0]
  return ASPECT_RATIOS[ASPECT_RATIOS.indexOf(current) + 1] ?? null
}

const USUAL_NAMES: [number, string][] = [
  [16 / 9, '16:9'],
  [16 / 10, '16:10'],
  [4 / 3, '4:3'],
  [5 / 4, '5:4'],
  [1, '1:1']
]

// nativeRatio: width / height of the file's own picture, once known.
export function aspectLabel(current: AspectRatio | null, nativeRatio: number | null): string {
  if (current) return current
  if (nativeRatio === null) return 'Default'
  const name = USUAL_NAMES.find(([r]) => Math.abs(r - nativeRatio) < 0.01)?.[1] ?? `${nativeRatio.toFixed(2)}:1`
  return `Default (${name})`
}

// The black bars around the picture, as shares of the window.
export type PictureInsets = { left: number; right: number; top: number; bottom: number }

// From mpv's osd-dimensions. Shares, not pixels: mpv counts physical pixels and the overlay doesn't.
export function pictureInsets(osd: unknown): PictureInsets | null {
  const { w, h, ml, mr, mt, mb } = (osd ?? {}) as Record<string, unknown>
  if (![w, h, ml, mr, mt, mb].every((v) => typeof v === 'number')) return null
  const [width, height] = [w as number, h as number]
  if (width <= 0 || height <= 0) return null
  return { left: (ml as number) / width, right: (mr as number) / width, top: (mt as number) / height, bottom: (mb as number) / height }
}

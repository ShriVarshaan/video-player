// Auto sync (milestone 7): what main answers and how the overlay words it.

export type AutoSyncOutcome =
  | { status: 'synced'; offset: number; scale: number; saved: string; fallback: boolean }
  // A synced file is already there; main holds the result until the user answers.
  | { status: 'exists'; offset: number; scale: number; name: string }
  | { status: 'inSync'; clearedOffset: boolean }
  | { status: 'noMatch' }
  | { status: 'cancelled' }

export type AutoSyncProgress = { key: string; stage: 'audio' | 'match'; pct: number | null }

// A result this close to "no change" is reported as already in sync.
export const IN_SYNC_S = 0.05

// scale = subtitle fps / video fps for the usual pairs (displayed = scale * t + offset).
const SPEEDS: [number, string][] = [
  [25 / 23.976, '25 → 23.976 fps'],
  [23.976 / 25, '23.976 → 25 fps'],
  [24 / 23.976, '24 → 23.976 fps'],
  [23.976 / 24, '23.976 → 24 fps'],
  [25 / 24, '25 → 24 fps'],
  [24 / 25, '24 → 25 fps']
]

function speedWords(scale: number): string | null {
  if (scale === 1) return null
  const known = SPEEDS.find(([r]) => Math.abs(scale - r) <= 0.0005 * r)
  return `speed ${known ? known[1] : 'adjusted'}`
}

export function describeSync(o: { offset: number; scale: number; fallback?: boolean }): string {
  const parts: string[] = []
  if (Math.abs(o.offset) >= IN_SYNC_S) parts.push(`${Math.abs(o.offset).toFixed(1)} s ${o.offset > 0 ? 'later' : 'earlier'}`)
  const speed = speedWords(o.scale)
  if (speed) parts.push(speed)
  return `Synced · ${parts.join(', ')}${o.fallback ? " · saved in the app's folder" : ''}`
}

export function describeOutcome(o: AutoSyncOutcome): string | null {
  switch (o.status) {
    case 'synced':
      return describeSync(o)
    case 'inSync':
      return o.clearedOffset ? 'Already in sync · offset cleared' : 'Already in sync'
    case 'noMatch':
      return "Couldn't sync this subtitle confidently"
    default:
      return null
  }
}

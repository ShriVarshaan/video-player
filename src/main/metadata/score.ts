import { normalizeTitle } from '@shared/normalize'

export type Candidate = { id: number; title: string; year: number | null; popularity: number }

const THRESHOLD = 0.8
const YEAR_BONUS = 0.1

function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!
    prev[0] = i
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j]!
      prev[j] = Math.min(up + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1))
      diag = up
    }
  }
  return prev[b.length]!
}

function similarity(a: string, b: string): number {
  const longer = Math.max(a.length, b.length)
  return longer === 0 ? 1 : 1 - levenshtein(a, b) / longer
}

// Score = title similarity (1 − edit distance / longer length, on normalized
// titles) + 0.1 when the year matches exactly. A year more than one off rejects
// the candidate; a missing year on either side neither helps nor hurts.
// Accept at 0.8 or above; ties go to the more popular title.
export function pickBest(query: { title: string; year: number | null }, candidates: Candidate[]): Candidate | null {
  const q = normalizeTitle(query.title)
  let best: { c: Candidate; score: number } | null = null
  for (const c of candidates) {
    if (query.year !== null && c.year !== null && Math.abs(query.year - c.year) > 1) continue
    const score = similarity(q, normalizeTitle(c.title)) + (query.year !== null && c.year === query.year ? YEAR_BONUS : 0)
    if (score < THRESHOLD) continue
    if (!best || score > best.score || (score === best.score && c.popularity > best.c.popularity)) {
      best = { c, score }
    }
  }
  return best?.c ?? null
}

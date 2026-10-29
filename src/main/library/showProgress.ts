import type { NextUp } from '@shared/library'

export type ProgressEpisode = {
  videoId: number
  season: number
  episode: number
  positionS: number
  durationS: number | null
  completed: boolean
  lastPlayedAt: number | null
}

const FINISHED_AT = 0.95

export function isFinished(e: Pick<ProgressEpisode, 'positionS' | 'durationS' | 'completed'>): boolean {
  return e.completed || (e.durationS !== null && e.durationS > 0 && e.positionS >= FINISHED_AT * e.durationS)
}

const play = (e: ProgressEpisode): NextUp => ({ action: 'play', videoId: e.videoId, season: e.season, episode: e.episode, positionS: 0 })

// The show page's main button (agreed with the user):
// - partway through the most recently played episode → continue it;
// - finished it → play the next local episode in order, wrapping to the first;
// - nothing played → play the first episode. Specials (season 0) are never "next".
export function nextUp(episodes: ProgressEpisode[]): NextUp | null {
  if (episodes.length === 0) return null
  const order = (a: ProgressEpisode, b: ProgressEpisode) => a.season - b.season || a.episode - b.episode
  const regular = episodes.filter((e) => e.season >= 1).sort(order)
  const first = regular[0] ?? [...episodes].sort(order)[0]!

  const last = episodes
    .filter((e) => e.lastPlayedAt !== null)
    .reduce<ProgressEpisode | null>((a, e) => (!a || e.lastPlayedAt! > a.lastPlayedAt! ? e : a), null)
  if (!last) return play(first)

  if (!isFinished(last)) {
    return { action: 'continue', videoId: last.videoId, season: last.season, episode: last.episode, positionS: last.positionS }
  }
  if (last.season === 0) return play(first)
  const i = regular.findIndex((e) => e.videoId === last.videoId)
  return play(regular[i + 1] ?? first)
}

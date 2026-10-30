import { describe, expect, it } from 'vitest'
import { isFinished, nextEpisode, nextUp, type ProgressEpisode } from '../../src/main/library/showProgress'

let id = 0
const ep = (season: number, episode: number, over: Partial<ProgressEpisode> = {}): ProgressEpisode => ({
  videoId: ++id,
  season,
  episode,
  positionS: 0,
  durationS: 3000,
  completed: false,
  lastPlayedAt: null,
  ...over
})
const at = (fraction: number, lastPlayedAt: number) => ({ positionS: 3000 * fraction, lastPlayedAt })

describe('isFinished', () => {
  it('is finished at 95 % or when marked completed', () => {
    expect(isFinished({ positionS: 2850, durationS: 3000, completed: false })).toBe(true)
    expect(isFinished({ positionS: 2849, durationS: 3000, completed: false })).toBe(false)
    expect(isFinished({ positionS: 300, durationS: 3000, completed: true })).toBe(true)
    expect(isFinished({ positionS: 500, durationS: null, completed: false })).toBe(false)
  })
})

describe('nextUp', () => {
  it('plays the first episode when nothing was watched, skipping specials', () => {
    const list = [ep(0, 1), ep(1, 2), ep(1, 1), ep(2, 1)]
    expect(nextUp(list)).toMatchObject({ action: 'play', season: 1, episode: 1, positionS: 0 })
  })

  it('continues the most recently played episode when partway through', () => {
    const list = [ep(1, 1, { ...at(1, 10), completed: true }), ep(1, 2, at(0.5, 20)), ep(1, 3)]
    expect(nextUp(list)).toMatchObject({ action: 'continue', season: 1, episode: 2, positionS: 1500 })
  })

  it('plays the next episode once the last one is finished', () => {
    const list = [ep(1, 1), ep(1, 2, at(0.96, 20)), ep(1, 3)]
    expect(nextUp(list)).toMatchObject({ action: 'play', season: 1, episode: 3, positionS: 0 })
  })

  it('treats completed as finished even early', () => {
    const list = [ep(1, 1, { ...at(0.1, 5), completed: true }), ep(1, 2)]
    expect(nextUp(list)).toMatchObject({ action: 'play', season: 1, episode: 2 })
  })

  it('moves on to the next season', () => {
    const list = [ep(1, 1), ep(1, 2, at(1, 20)), ep(2, 1)]
    expect(nextUp(list)).toMatchObject({ action: 'play', season: 2, episode: 1 })
  })

  it('goes back to the first episode after the final one', () => {
    const list = [ep(1, 1, at(1, 10)), ep(1, 2, at(1, 20))]
    expect(nextUp(list)).toMatchObject({ action: 'play', season: 1, episode: 1, positionS: 0 })
  })

  it('after a finished special, plays the first regular episode', () => {
    const list = [ep(0, 1, at(1, 30)), ep(1, 1), ep(1, 2)]
    expect(nextUp(list)).toMatchObject({ action: 'play', season: 1, episode: 1 })
  })

  it('skips episodes that are not on disk', () => {
    const list = [ep(1, 1, at(1, 10)), ep(1, 3)]
    expect(nextUp(list)).toMatchObject({ action: 'play', season: 1, episode: 3 })
  })

  it('is null for a show with no episodes', () => {
    expect(nextUp([])).toBeNull()
  })
})

describe('nextEpisode', () => {
  const s1e1 = ep(1, 1)
  const s1e3 = ep(1, 3)
  const s2e1 = ep(2, 1)
  const special = ep(0, 1)
  const all = [s2e1, special, s1e3, s1e1]

  it('plays the next local episode in the season, skipping missing numbers', () => {
    expect(nextEpisode(all, s1e1.videoId)).toBe(s1e3)
  })
  it('moves on to the first episode of the next season', () => {
    expect(nextEpisode(all, s1e3.videoId)).toBe(s2e1)
  })
  it('is null after the last episode, after a special, and for an unknown id', () => {
    expect(nextEpisode(all, s2e1.videoId)).toBeNull()
    expect(nextEpisode(all, special.videoId)).toBeNull()
    expect(nextEpisode(all, -1)).toBeNull()
  })
})

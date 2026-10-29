import { describe, expect, it } from 'vitest'
import { isVideoFile, parseVideoPath } from '../../src/main/library/parseName'

const movie = (title: string, year: number | null) => ({ kind: 'movie', title, year })
const ep = (show: string, season: number, episode: number, episodeEnd: number | null = null, year: number | null = null) => ({
  kind: 'episode',
  show,
  year,
  season,
  episode,
  episodeEnd
})

describe('parseVideoPath', () => {
  it.each([
    ['The.Matrix.1999.1080p.BluRay.x264.mkv', movie('The Matrix', 1999)],
    ['Amélie (2001).mp4', movie('Amélie', 2001)],
    ['inception_2010_720p.webm', movie('inception', 2010)],
    ['Some Unknown Home Video.avi', movie('Some Unknown Home Video', null)],
    ['Amélie (2001)/movie.mkv', movie('Amélie', 2001)],
    ['Amélie (2001)\\movie.mkv', movie('Amélie', 2001)],
    ['Breaking.Bad.S02E05.720p.mkv', ep('Breaking Bad', 2, 5)],
    ['the.office.us.s03e01-e02.mkv', ep('the office us', 3, 1, 2)],
    ['The.Office.S03E01E02.mkv', ep('The Office', 3, 1, 2)],
    ['Show Name - 1x02 - Title.avi', ep('Show Name', 1, 2)],
    ['Doctor.Who.2005.S01E01.mkv', ep('Doctor Who', 1, 1, null, 2005)],
    ["Breaking Bad/Season 1/02 - Cat's in the Bag.mkv", ep('Breaking Bad', 1, 2)],
    ['Breaking Bad/S01/S01E03.mkv', ep('Breaking Bad', 1, 3)],
    ['Breaking Bad/Specials/01 - Pilot Extended.mkv', ep('Breaking Bad', 0, 1)]
  ])('%s', (path, expected) => {
    expect(parseVideoPath(path)).toEqual(expected)
  })

  it.each([
    'The.Matrix.1999.sample.mkv',
    'Movie/Sample/x.mkv',
    'Movie (2001)/Extras/Making Of.mkv',
    'Featurettes/a.mkv',
    'Behind The Scenes/b.mkv',
    'Show/Trailers/t.mp4'
  ])('skips %s', (path) => {
    expect(parseVideoPath(path)).toBeNull()
  })
})

describe('parseVideoPath with the library folder name', () => {
  it('uses it when the files sit directly in a show folder', () => {
    expect(parseVideoPath('Season 1/01 - Pilot.mkv', 'Breaking Bad')).toEqual(ep('Breaking Bad', 1, 1))
    expect(parseVideoPath('Season 1/S01E02.mkv', 'Breaking Bad')).toEqual(ep('Breaking Bad', 1, 2))
  })

  it('uses it for a generic movie file name', () => {
    expect(parseVideoPath('movie.mkv', 'Amélie (2001)')).toEqual(movie('Amélie', 2001))
  })

  it('never names a show after an episode code', () => {
    expect(parseVideoPath('S01E02.mkv')).toEqual(ep('Unknown show', 1, 2))
  })
})

describe('isVideoFile', () => {
  it('matches video extensions case-insensitively', () => {
    expect(isVideoFile('A.MKV')).toBe(true)
    expect(isVideoFile('a.ts')).toBe(true)
    expect(isVideoFile('a.srt')).toBe(false)
    expect(isVideoFile('mkv')).toBe(false)
  })
})

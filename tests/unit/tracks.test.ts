import { describe, expect, it } from 'vitest'
import type { Track } from '@shared/player'
import { languageName, pickSubtitle, pickTrack, refOf, subtitlePrefFor, toTracks } from '../../src/main/player/tracks'

const mpvList = [
  { id: 1, type: 'video', codec: 'h264' },
  { id: 1, type: 'audio', lang: 'eng', 'demux-channel-count': 6, default: true, codec: 'eac3' },
  { id: 2, type: 'audio', lang: 'jpn', 'demux-channel-count': 2, codec: 'aac' },
  { id: 3, type: 'audio', title: 'Director commentary', codec: 'aac' },
  { id: 4, type: 'audio', codec: 'aac' },
  { id: 1, type: 'sub', lang: 'eng', title: 'English', codec: 'subrip' },
  { id: 2, type: 'sub', lang: 'eng', title: 'English SDH', codec: 'subrip' },
  { id: 3, type: 'sub', lang: 'eng', forced: true, codec: 'subrip' },
  { id: 4, type: 'sub', lang: 'eng', 'hearing-impaired': true, codec: 'ass' },
  { id: 5, type: 'sub', lang: 'fre', codec: 'hdmv_pgs_subtitle' }
]

describe('toTracks', () => {
  const tracks = toTracks(mpvList)
  const audio = tracks.filter((t) => t.type === 'audio')
  const subs = tracks.filter((t) => t.type === 'sub')

  it('drops video tracks', () => {
    expect(tracks.every((t) => t.type !== ('video' as string))).toBe(true)
    expect(tracks).toHaveLength(9)
  })

  it('labels audio by language and channels, then title, then number', () => {
    expect(audio.map((t) => t.label)).toEqual(['English 5.1', 'Japanese', 'Director commentary', 'Track 4'])
    expect(audio[0]).toMatchObject({ id: 1, lang: 'eng', kind: 'plain', default: true, image: false })
    expect(audio[2]!.kind).toBe('commentary')
  })

  it('detects subtitle kinds and labels them', () => {
    expect(subs.map((t) => [t.kind, t.label])).toEqual([
      ['plain', 'English'],
      ['sdh', 'English (SDH)'],
      ['forced', 'English (Forced)'],
      ['sdh', 'English (SDH)'],
      ['plain', 'French']
    ])
  })

  it('marks picture-based subtitles', () => {
    expect(subs.map((t) => t.image)).toEqual([false, false, false, false, true])
  })

  it('returns [] for anything that is not a list', () => {
    expect(toTracks(null)).toEqual([])
  })
})

describe('languageName', () => {
  it('names ISO 639-2 codes', () => {
    expect(languageName('eng')).toBe('English')
    expect(languageName('jpn')).toBe('Japanese')
  })
  it('falls back to the code in capitals', () => {
    expect(languageName('xx1')).toBe('XX1')
  })
})

const t = (id: number, lang: string | null, kind: Track['kind'], title: string | null = null, type: Track['type'] = 'sub'): Track => ({
  id,
  type,
  label: '',
  lang,
  kind,
  title,
  image: false,
  default: false
})

describe('pickTrack', () => {
  const subs = [t(1, 'eng', 'plain'), t(2, 'eng', 'sdh', 'English SDH'), t(3, 'jpn', 'plain'), t(4, null, 'plain', 'Signs')]

  it('prefers the same language and kind', () => {
    expect(pickTrack(subs, { lang: 'eng', kind: 'sdh', title: null })?.id).toBe(2)
  })
  it('falls back to the same language, plain kind', () => {
    expect(pickTrack(subs, { lang: 'jpn', kind: 'sdh', title: null })?.id).toBe(3)
  })
  it('falls back to the same title', () => {
    expect(pickTrack(subs, { lang: null, kind: 'plain', title: 'Signs' })?.id).toBe(4)
  })
  it('returns null when nothing matches or nothing is remembered', () => {
    expect(pickTrack(subs, { lang: 'ger', kind: 'plain', title: null })).toBeNull()
    expect(pickTrack(subs, null)).toBeNull()
    expect(pickTrack([], { lang: 'eng', kind: 'plain', title: null })).toBeNull()
  })
})

describe('pickSubtitle', () => {
  const subs = [t(1, 'eng', 'plain'), t(2, 'eng', 'forced'), t(3, 'jpn', 'forced')]

  it("shows nothing for 'off'", () => {
    expect(pickSubtitle(subs, 'off', 'eng')).toBeNull()
  })
  it('follows a remembered track', () => {
    expect(pickSubtitle(subs, { lang: 'eng', kind: 'plain', title: null }, 'eng')?.id).toBe(1)
  })
  it('shows the forced track in the audio language when nothing is remembered', () => {
    expect(pickSubtitle(subs, null, 'jpn')?.id).toBe(3)
    expect(pickSubtitle(subs, null, 'ger')).toBeNull()
    expect(pickSubtitle(subs, null, null)).toBeNull()
  })
})

describe('subtitlePrefFor', () => {
  it("remembers 'off' only when it hid a forced track", () => {
    expect(subtitlePrefFor(null, true)).toBe('off')
    expect(subtitlePrefFor(null, false)).toBeNull()
  })
  it('remembers a chosen track by reference', () => {
    const sdh = t(2, 'eng', 'sdh', 'English SDH')
    expect(subtitlePrefFor(sdh, true)).toEqual({ lang: 'eng', kind: 'sdh', title: 'English SDH' })
    expect(refOf(sdh)).toEqual({ lang: 'eng', kind: 'sdh', title: 'English SDH' })
  })
})

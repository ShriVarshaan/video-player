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
  default: false,
  external: false,
  fileName: null
})

describe('pickTrack', () => {
  const subs = [t(1, 'eng', 'plain'), t(2, 'eng', 'sdh', 'English SDH'), t(3, 'jpn', 'plain'), t(4, null, 'plain', 'Signs')]

  it('prefers the same language and kind', () => {
    expect(pickTrack(subs, { lang: 'eng', kind: 'sdh', title: null })?.id).toBe(2)
  })
  it('prefers the very same track (by title) within a language and kind', () => {
    const two = [t(1, 'eng', 'plain', 'English'), t(2, 'eng', 'plain', 'movie.en.srt')]
    expect(pickTrack(two, { lang: 'eng', kind: 'plain', title: 'movie.en.srt' })?.id).toBe(2)
    expect(pickTrack(two, { lang: 'eng', kind: 'plain', title: 'other.srt' })?.id).toBe(1)
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
  const ctx = (audioLang: string | null, userLang = 'eng', preferSdh = false) => ({ audioLang, userLang, preferSdh })
  const ext = (id: number, lang: string, kind: Track['kind']): Track => ({ ...t(id, lang, kind), external: true, fileName: `m.${lang}.srt` })

  it("shows nothing for 'off'", () => {
    expect(pickSubtitle(subs, 'off', ctx('eng'))).toBeNull()
  })
  it('follows a remembered track', () => {
    expect(pickSubtitle(subs, { lang: 'eng', kind: 'plain', title: null }, ctx('eng'))?.id).toBe(1)
  })
  it('shows the forced track in the audio language when nothing is remembered', () => {
    expect(pickSubtitle(subs, null, ctx('jpn', 'jpn'))?.id).toBe(3)
    expect(pickSubtitle(subs, null, ctx('ger', 'ger'))).toBeNull()
    expect(pickSubtitle(subs, null, ctx(null))).toBeNull()
  })

  it('turns on a subtitle file in your language every time, whatever the audio', () => {
    const all = [...subs, ext(4, 'eng', 'forced'), ext(5, 'eng', 'plain'), ext(6, 'eng', 'sdh'), ext(7, 'fre', 'plain')]
    expect(pickSubtitle(all, null, ctx('eng'))?.id).toBe(5)
    expect(pickSubtitle(all, null, ctx('eng', 'eng', true))?.id).toBe(6)
    expect(pickSubtitle(all, null, ctx('jpn'))?.id).toBe(5)
    expect(pickSubtitle([...subs, ext(4, 'eng', 'forced')], null, ctx('eng'))?.id).toBe(4)
  })

  it('remembered choices and Off still win over a subtitle file', () => {
    const all = [...subs, ext(5, 'eng', 'plain')]
    expect(pickSubtitle(all, { lang: 'eng', kind: 'forced', title: null }, ctx('eng'))?.id).toBe(2)
    expect(pickSubtitle(all, 'off', ctx('eng'))).toBeNull()
  })

  it('turns on an embedded subtitle in your language only for foreign audio', () => {
    const embedded = [t(1, 'eng', 'plain'), t(2, 'eng', 'sdh'), t(3, 'jpn', 'forced')]
    expect(pickSubtitle(embedded, null, ctx('eng'))).toBeNull()
    expect(pickSubtitle(embedded, null, ctx('jpn'))?.id).toBe(1)
    expect(pickSubtitle(embedded, null, ctx('jpn', 'eng', true))?.id).toBe(2)
  })
})

describe('toTracks with subtitle files', () => {
  it('takes language and kind from the matched file, and marks it external', () => {
    const list = [
      { id: 1, type: 'sub', lang: 'eng', codec: 'subrip' },
      { id: 2, type: 'sub', external: true, 'external-filename': 'C:\\M\\Movie.srt', title: 'Movie.srt', codec: 'subrip' }
    ]
    const [embedded, file] = toTracks(list, [{ path: 'C:/M/Movie.srt', lang: 'fre', kind: 'sdh', format: 'srt' }])
    expect(embedded).toMatchObject({ external: false, fileName: null })
    expect(file).toMatchObject({ id: 2, lang: 'fre', kind: 'sdh', label: 'French (SDH)', external: true, fileName: 'Movie.srt' })
  })
})

describe('subtitlePrefFor', () => {
  it("remembers 'off' only when it hid a track the app turned on by itself", () => {
    expect(subtitlePrefFor(null, true)).toBe('off')
    expect(subtitlePrefFor(null, false)).toBeNull()
  })
  it('remembers a chosen track by reference', () => {
    const sdh = t(2, 'eng', 'sdh', 'English SDH')
    expect(subtitlePrefFor(sdh, true)).toEqual({ lang: 'eng', kind: 'sdh', title: 'English SDH' })
    expect(refOf(sdh)).toEqual({ lang: 'eng', kind: 'sdh', title: 'English SDH' })
  })
})

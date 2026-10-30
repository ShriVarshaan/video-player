import type { Track, TrackKind, TrackRef } from '@shared/player'

const IMAGE_CODECS = new Set(['hdmv_pgs_subtitle', 'dvd_subtitle', 'dvb_subtitle'])
const KIND_SUFFIX: Record<TrackKind, string> = { plain: '', forced: ' (Forced)', sdh: ' (SDH)', commentary: ' (Commentary)' }
const names = new Intl.DisplayNames(['en'], { type: 'language' })

export function languageName(code: string): string {
  try {
    const name = names.of(code)
    if (name && name.toLowerCase() !== code.toLowerCase()) return name
  } catch {
    // Not a language code Intl knows.
  }
  return code.toUpperCase()
}

const channels = (n: unknown) => (n === 6 ? ' 5.1' : n === 8 ? ' 7.1' : '')

function kindOf(t: Record<string, unknown>, title: string | null): TrackKind {
  if (t['forced'] === true) return 'forced'
  if (t['hearing-impaired'] === true || (title && /SDH|hearing/i.test(title))) return 'sdh'
  if (title && /commentary/i.test(title)) return 'commentary'
  return 'plain'
}

// mpv's track-list → the audio and subtitle tracks the menus show.
export function toTracks(trackList: unknown): Track[] {
  if (!Array.isArray(trackList)) return []
  const out: Track[] = []
  for (const raw of trackList as Record<string, unknown>[]) {
    const type = raw['type']
    if (type !== 'audio' && type !== 'sub') continue
    const id = Number(raw['id'])
    const lang = typeof raw['lang'] === 'string' && raw['lang'] !== 'und' ? raw['lang'] : null
    const title = typeof raw['title'] === 'string' && raw['title'] ? raw['title'] : null
    const kind = kindOf(raw, title)
    let label: string
    if (lang) label = languageName(lang) + (type === 'audio' ? channels(raw['demux-channel-count']) : KIND_SUFFIX[kind])
    else label = title ?? `Track ${id}`
    out.push({
      id,
      type,
      label,
      lang,
      kind,
      title,
      image: type === 'sub' && IMAGE_CODECS.has(String(raw['codec'])),
      default: raw['default'] === true
    })
  }
  return out
}

export const refOf = (t: Track): TrackRef => ({ lang: t.lang, kind: t.kind, title: t.title })

// The remembered track in this file: same language and kind, then same language
// plain, then same title. null keeps mpv's own choice.
export function pickTrack(tracks: Track[], ref: TrackRef | null): Track | null {
  if (!ref) return null
  if (ref.lang) {
    const same = tracks.filter((t) => t.lang === ref.lang)
    const hit = same.find((t) => t.kind === ref.kind) ?? same.find((t) => t.kind === 'plain')
    if (hit) return hit
  }
  return (ref.title && tracks.find((t) => t.title === ref.title)) || null
}

// Nothing remembered still shows forced subtitles in the audio's language.
export function pickSubtitle(subs: Track[], pref: TrackRef | 'off' | null, audioLang: string | null): Track | null {
  if (pref === 'off') return null
  if (pref) return pickTrack(subs, pref)
  return (audioLang && subs.find((t) => t.kind === 'forced' && t.lang === audioLang)) || null
}

// Choosing Off is remembered only when it hid a forced track; otherwise nothing is.
export function subtitlePrefFor(choice: Track | null, forcedShowing: boolean): TrackRef | 'off' | null {
  if (choice) return refOf(choice)
  return forcedShowing ? 'off' : null
}

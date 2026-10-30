import { basename } from 'node:path'
import { languageName } from '@shared/lang'
import type { Track, TrackKind, TrackRef } from '@shared/player'
import type { ExternalSub } from '../subtitles/match'

export { languageName }

const IMAGE_CODECS = new Set(['hdmv_pgs_subtitle', 'dvd_subtitle', 'dvb_subtitle'])
const KIND_SUFFIX: Record<TrackKind, string> = { plain: '', forced: ' (Forced)', sdh: ' (SDH)', commentary: ' (Commentary)' }

const channels = (n: unknown) => (n === 6 ? ' 5.1' : n === 8 ? ' 7.1' : '')

function kindOf(t: Record<string, unknown>, title: string | null): TrackKind {
  if (t['forced'] === true) return 'forced'
  if (t['hearing-impaired'] === true || (title && /SDH|hearing/i.test(title))) return 'sdh'
  if (title && /commentary/i.test(title)) return 'commentary'
  return 'plain'
}

const slashes = (p: string) => p.replace(/\\/g, '/')
const samePath = (a: string, b: string) => slashes(a).toLowerCase() === slashes(b).toLowerCase()

// mpv's track-list → the audio and subtitle tracks the menus show. Subtitle
// files take their language and kind from the file name (see subtitles/match).
export function toTracks(trackList: unknown, externals: ExternalSub[] = []): Track[] {
  if (!Array.isArray(trackList)) return []
  const out: Track[] = []
  for (const raw of trackList as Record<string, unknown>[]) {
    const type = raw['type']
    if (type !== 'audio' && type !== 'sub') continue
    const id = Number(raw['id'])
    const file = typeof raw['external-filename'] === 'string' ? raw['external-filename'] : null
    const ext = file ? externals.find((e) => samePath(e.path, file)) : undefined
    const tagged = typeof raw['lang'] === 'string' && raw['lang'] !== 'und' ? raw['lang'] : null
    const lang = ext ? ext.lang : tagged
    const title = typeof raw['title'] === 'string' && raw['title'] ? raw['title'] : null
    const kind = ext ? ext.kind : kindOf(raw, title)
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
      default: raw['default'] === true,
      external: raw['external'] === true,
      fileName: raw['external'] === true && file ? (title ?? basename(slashes(file))) : null
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

export type PickContext = { audioLang: string | null; userLang: string; preferSdh: boolean }

// The best track in a language: SDH first when preferred, else plain; forced last.
function bestIn(subs: Track[], lang: string, preferSdh: boolean): Track | null {
  const same = subs.filter((t) => t.lang === lang && t.kind !== 'commentary')
  const order: TrackKind[] = preferSdh ? ['sdh', 'plain', 'forced'] : ['plain', 'sdh', 'forced']
  for (const kind of order) {
    const hit = same.find((t) => t.kind === kind)
    if (hit) return hit
  }
  return null
}

// With nothing remembered: a subtitle file in your language comes on every time;
// else an embedded one in your language when the audio is foreign; else a forced
// track in the audio's language.
export function pickSubtitle(subs: Track[], pref: TrackRef | 'off' | null, ctx: PickContext): Track | null {
  if (pref === 'off') return null
  if (pref) return pickTrack(subs, pref)
  const file = bestIn(subs.filter((t) => t.external), ctx.userLang, ctx.preferSdh)
  if (file) return file
  // Unknown audio counts as your language (the service has already tried TMDB).
  if (ctx.audioLang && ctx.audioLang !== ctx.userLang) {
    const embedded = bestIn(subs.filter((t) => !t.external && !t.image), ctx.userLang, ctx.preferSdh)
    if (embedded) return embedded
  }
  return (ctx.audioLang && subs.find((t) => t.kind === 'forced' && t.lang === ctx.audioLang)) || null
}

// Choosing Off is remembered when it hid a track the app turned on by itself
// (a forced track or an automatic pick); otherwise nothing is.
export function subtitlePrefFor(choice: Track | null, autoShowing: boolean): TrackRef | 'off' | null {
  if (choice) return refOf(choice)
  return autoShowing ? 'off' : null
}

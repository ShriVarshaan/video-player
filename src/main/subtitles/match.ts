import { readdir } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { normalizeLang } from '@shared/lang'
import type { TrackKind } from '@shared/player'
import { isVideoFile, parseVideoPath } from '../library/parseName'

export type SubFormat = 'srt' | 'vtt' | 'ass' | 'ssa'

export type ExternalSub = { path: string; lang: string | null; kind: TrackKind; format: SubFormat }

const FORMATS = new Set<string>(['srt', 'vtt', 'ass', 'ssa'])
const FORCED = new Set(['forced', 'foreign'])
const SDH = new Set(['sdh', 'hi', 'cc'])

const fold = (s: string) => s.normalize('NFC').toLowerCase()
const stem = (name: string) => name.slice(0, name.length - extname(name).length)
const formatOf = (name: string): SubFormat | null => {
  const ext = extname(name).slice(1).toLowerCase()
  return FORMATS.has(ext) ? (ext as SubFormat) : null
}

// The file is named after this video: its name, then the end or a separator
// ("Toy Story.en.srt" yes, "Toy Story 2.en.srt" no for "Toy Story", "S01E10" no for "S01E1").
function namedAfter(fileName: string, videoBase: string): boolean {
  const n = fold(stem(fileName))
  const b = fold(videoBase)
  return n.startsWith(b) && (n.length === b.length || /[._\s-]/.test(n[b.length]!))
}

// Language and kind from the words after the video's name ("Movie.en.forced.srt").
// A file named otherwise ("It.Follows.2014.srt") is read only from its last three
// words, and two-letter codes only as the very last word, so "It" or "In" in a
// title isn't taken for a language. Later words win.
export function parseSubName(fileName: string, videoBase: string): { lang: string | null; kind: TrackKind } {
  const base = stem(fileName)
  const own = namedAfter(fileName, videoBase)
  const words = (own ? base.slice(videoBase.length) : base).split(/[._\s-]+/).filter(Boolean).reverse()
  let lang: string | null = null
  let kind: TrackKind = 'plain'
  for (const [i, word] of (own ? words : words.slice(0, 3)).entries()) {
    const w = word.toLowerCase()
    if (FORCED.has(w)) kind = 'forced'
    else if (SDH.has(w)) kind = kind === 'forced' ? kind : 'sdh'
    else if (own || w.length > 2 || i === 0) lang ??= normalizeLang(w)
  }
  return { lang, kind }
}

async function list(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir, { withFileTypes: true })).filter((e) => e.isFile()).map((e) => e.name)
  } catch {
    return [] // missing or unreadable: nothing here
  }
}

// Subtitle files that belong to a video: next to it, in Subs/ or Subtitles/
// (or a folder named after the video inside them), and in extraDirs.
export async function findSubtitles(
  video: { path: string; season: number | null; episode: number | null },
  opts: { userLang: string; extraDirs?: string[] }
): Promise<ExternalSub[]> {
  const dir = dirname(video.path)
  const videoBase = stem(basename(video.path))
  const siblings = await list(dir)
  const videoBases = siblings.filter(isVideoFile).map(stem)
  const onlyVideo = videoBases.length <= 1
  // Named after this video, and not after a longer-named one beside it ("Toy Story 2").
  const ours = (name: string) =>
    namedAfter(name, videoBase) && !videoBases.some((b) => b.length > videoBase.length && namedAfter(name, b))

  const sameEpisode = (name: string) => {
    if (video.season === null || video.episode === null) return false
    const p = parseVideoPath(`${stem(name)}.mkv`)
    return p?.kind === 'episode' && p.season === video.season && p.episode === video.episode
  }
  const belongs = (name: string) => onlyVideo || ours(name) || sameEpisode(name)

  const places: { dir: string; any: boolean }[] = [
    { dir, any: false },
    ...['Subs', 'Subtitles'].flatMap((s) => [
      { dir: join(dir, s), any: false },
      { dir: join(dir, s, videoBase), any: true }
    ]),
    ...(opts.extraDirs ?? []).map((d) => ({ dir: d, any: true }))
  ]

  const out: ExternalSub[] = []
  const seen = new Set<string>()
  for (const place of places) {
    for (const name of await list(place.dir)) {
      const format = formatOf(name)
      const path = join(place.dir, name)
      if (!format || seen.has(fold(path)) || !(place.any || belongs(name))) continue
      seen.add(fold(path))
      const { lang, kind } = parseSubName(name, videoBase)
      out.push({ path, lang: lang ?? opts.userLang, kind, format })
    }
  }
  return out
}

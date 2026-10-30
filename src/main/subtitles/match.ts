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

// Language and kind from the words after the video's name ("Movie.en.forced.srt"),
// or from the whole name when it doesn't start with it. Later words win.
export function parseSubName(fileName: string, videoBase: string): { lang: string | null; kind: TrackKind } {
  const base = stem(fileName)
  const rest = fold(base).startsWith(fold(videoBase)) ? base.slice(videoBase.length) : base
  let lang: string | null = null
  let kind: TrackKind = 'plain'
  for (const word of rest.split(/[._\s-]+/).filter(Boolean).reverse()) {
    const w = word.toLowerCase()
    if (FORCED.has(w)) kind = 'forced'
    else if (SDH.has(w)) kind = kind === 'forced' ? kind : 'sdh'
    else lang ??= normalizeLang(w)
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
  const onlyVideo = siblings.filter(isVideoFile).length <= 1

  const sameEpisode = (name: string) => {
    if (video.season === null || video.episode === null) return false
    const p = parseVideoPath(`${stem(name)}.mkv`)
    return p?.kind === 'episode' && p.season === video.season && p.episode === video.episode
  }
  const belongs = (name: string) => onlyVideo || fold(name).startsWith(fold(videoBase)) || sameEpisode(name)

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

import { parse } from 'parse-torrent-title'
import { normalizeTitle } from '@shared/normalize'

export type ParsedVideo =
  | { kind: 'movie'; title: string; year: number | null }
  | {
      kind: 'episode'
      show: string
      year: number | null
      season: number
      episode: number
      episodeEnd: number | null
    }

export const VIDEO_EXTENSIONS: ReadonlySet<string> = new Set(
  ['mkv', 'mp4', 'm4v', 'avi', 'mov', 'webm', 'wmv', 'mpg', 'mpeg', 'ts', 'm2ts', 'flv', 'ogv', '3gp'].map(
    (e) => `.${e}`
  )
)

const SKIPPED_FOLDER = /^(extras|featurettes|behind the scenes|deleted scenes|trailers|samples?)$/i
const SEASON_FOLDER = /^(?:season[ ._-]*(\d{1,3})|s(\d{1,3})|(specials))$/i
// S03E01, S03E01E02, S03E01-E02 (parse-torrent-title misses the second episode).
const SXXEYY = /s(\d{1,2})e(\d{1,3})(?:-?e(\d{1,3}))?/i
const GENERIC_TITLES = new Set(['movie', 'video', 'film'])

function extension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? '' : name.slice(dot).toLowerCase()
}

export function isVideoFile(name: string): boolean {
  return VIDEO_EXTENSIONS.has(extension(name))
}

function seasonOfFolder(name: string): number | null {
  const m = SEASON_FOLDER.exec(name.trim())
  if (!m) return null
  if (m[3]) return 0
  return Number(m[1] ?? m[2])
}

function isGeneric(title: string): boolean {
  const n = normalizeTitle(title)
  return n === '' || GENERIC_TITLES.has(n) || /^\d+$/.test(n)
}

const UNKNOWN_SHOW = 'Unknown show'

// The nearest non-season folder above a file is the show (or the movie's own
// folder). The library folder itself counts too, for a show added directly.
function nearestNamedFolder(dirs: string[]): string | null {
  for (let i = dirs.length - 1; i >= 0; i--) {
    if (seasonOfFolder(dirs[i]!) === null) return dirs[i]!
  }
  return null
}

// relativePath is relative to the library folder; rootName is that folder's own
// name, used only when nothing below it names the show or movie.
export function parseVideoPath(relativePath: string, rootName?: string): ParsedVideo | null {
  const parts = relativePath.split(/[\\/]+/).filter(Boolean)
  const file = parts.pop()
  if (!file || !isVideoFile(file)) return null
  if (parts.some((d) => SKIPPED_FOLDER.test(d.trim()))) return null

  const base = file.slice(0, file.length - extension(file).length)
  if (/\bsample\b/i.test(base.replace(/[._]/g, ' '))) return null

  const parsed = parse(file)
  const sxe = SXXEYY.exec(base)
  const folderSeason = parts.length ? seasonOfFolder(parts[parts.length - 1]!) : null
  const dirs = rootName ? [rootName, ...parts] : parts
  const showFromFolder = () => nearestNamedFolder(dirs) ?? UNKNOWN_SHOW

  if (sxe || (parsed.season !== undefined && parsed.episode !== undefined)) {
    const title = parsed.title ?? ''
    const show = isGeneric(title) || SXXEYY.test(title) ? showFromFolder() : title
    return {
      kind: 'episode',
      show,
      year: parsed.year ?? null,
      season: sxe ? Number(sxe[1]) : parsed.season!,
      episode: sxe ? Number(sxe[2]) : parsed.episode!,
      episodeEnd: sxe?.[3] ? Number(sxe[3]) : null
    }
  }

  // "Show/Season 1/02 - Title.mkv": episode number leads the name inside a season folder.
  const leading = /^(\d{1,3})\b/.exec(base)
  if (folderSeason !== null && leading) {
    return {
      kind: 'episode',
      show: showFromFolder(),
      year: null,
      season: folderSeason,
      episode: Number(leading[1]),
      episodeEnd: null
    }
  }

  const title = parsed.title ?? base
  if (isGeneric(title) && dirs.length) {
    const name = dirs[dirs.length - 1]!
    const folder = parse(name)
    return { kind: 'movie', title: folder.title ?? name, year: folder.year ?? parsed.year ?? null }
  }
  return { kind: 'movie', title, year: parsed.year ?? null }
}

// Library shapes shared by main and renderer.

export type LibraryFolder = { id: number; path: string; online: boolean; videoCount: number; lastScanAt: number | null }

export type MovieItem = { videoId: number; title: string; year: number | null; posterUrl: string; matched: boolean }

// key is 'tmdb:<id>' for a matched show, 'local:<parsed_show>' otherwise.
export type ShowItem = {
  key: string
  name: string
  year: number | null
  posterUrl: string
  episodeCount: number
  matched: boolean
}

export type EpisodeItem = {
  season: number
  episode: number
  title: string | null
  videoId: number
  stillUrl: string
  positionS: number
  durationS: number | null
  finished: boolean
}

export type NextUp = { action: 'play' | 'continue'; videoId: number; season: number; episode: number; positionS: number }

export type ShowDetail = {
  key: string
  name: string
  overview: string | null
  seasons: { season: number; name: string; episodes: EpisodeItem[] }[]
  nextUp: NextUp | null
}

export type ScanProgress = { phase: 'scanning' | 'probing' | 'matching' | 'images' | 'idle'; done: number; total: number }

export type MetadataStatus = { hasKey: boolean; pending: number; unmatched: number }

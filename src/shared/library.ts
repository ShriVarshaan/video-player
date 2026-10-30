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

// One tile on the home wall: a movie or a whole show, ready to draw.
export type WallItem = {
  key: string // 'movie:<videoId>', or the show key ('tmdb:<id>' | 'local:<parsed_show>')
  kind: 'movie' | 'show'
  order: number // wall position: movies' wall_key, FNV-1a of a show's key
  title: string
  year: number | null
  posterUrl: string
  backdropUrl: string | null // null when TMDB has none; the wall blurs the poster instead
  matched: boolean
  runtimeMin: number | null
  seasonCount: number | null
  episodeCount: number | null
  genres: string[]
  rating: number | null
  overview: string | null
  progress: number | null // 0–1 for a movie started and not finished
  playLabel: 'Play' | 'Play episode' | 'Continue watching'
}

export type ScanProgress = { phase: 'scanning' | 'probing' | 'matching' | 'images' | 'idle'; done: number; total: number }

export type MetadataStatus = { hasKey: boolean; pending: number; unmatched: number }

// A play button on the title page: which file, and whether to resume it.
export type TitleButton = { label: string; videoId: number; from: 'resume' | 'start' }

// Everything the title page shows, for a movie or a show.
export type TitleDetail = {
  key: string
  kind: 'movie' | 'show'
  title: string
  year: number | null
  runtimeMin: number | null
  seasonCount: number | null
  episodeCount: number | null
  genres: string[]
  rating: number | null
  overview: string | null // full TMDB overview, not cut to a sentence
  posterUrl: string
  backdropUrl: string | null
  matched: boolean
  watched: boolean // a movie finished (completed or past 95 %)
  main: TitleButton
  restart: TitleButton | null
  remainingS: number | null // when the main button continues
  progress: number | null
  seasons: ShowDetail['seasons'] // [] for movies
  openSeason: number | null // the season holding the next-up episode
}

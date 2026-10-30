// Player shapes shared by main and the overlay.

export type TrackKind = 'plain' | 'forced' | 'sdh' | 'commentary'

// How a chosen track is remembered: track ids differ between files, so match by these.
export type TrackRef = { lang: string | null; kind: TrackKind; title: string | null }

// One audio or subtitle track of the playing file. id is mpv's aid/sid.
export type Track = {
  id: number
  type: 'audio' | 'sub'
  label: string
  lang: string | null
  kind: TrackKind
  title: string | null
  image: boolean // picture-based subtitles (PGS/VobSub/DVB), always drawn by mpv
  default: boolean
}

// Remembered per title (movie or whole show), never app-wide.
export type TitlePrefs = { volume: number; audio: TrackRef | null; subtitle: TrackRef | 'off' | null }

// What the overlay draws, sent about 30 times a second while playing.
export type PlayerState = {
  titleKey: string
  videoId: number
  heading: string // "Arrival" or "Severance · S2 E4 · Woe's Hollow"
  paused: boolean
  positionS: number
  durationS: number | null
  volume: number // 0–200
  muted: boolean
  audio: Track[]
  subtitles: Track[]
  audioId: number | null
  subtitleId: number | null
  fullScreen: boolean
}

export type NextEpisode = { videoId: number; season: number; episode: number; title: string | null; stillUrl: string }

export type PlayerCommand =
  | { type: 'pause'; paused: boolean }
  | { type: 'seek'; toS: number }
  | { type: 'seekBy'; s: number }
  | { type: 'volume'; value: number }
  | { type: 'mute'; muted: boolean }
  | { type: 'audio'; id: number }
  | { type: 'subtitle'; id: number | null }
  | { type: 'fullScreen'; on: boolean }

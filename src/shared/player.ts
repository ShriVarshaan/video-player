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
  external: boolean // a subtitle file next to the video (or downloaded), not inside it
  fileName: string | null
  // Subtitles: which stored timing fix belongs to this track ('file:…' / 'embedded:…'); null for audio.
  key: string | null
  codec: string | null
  synced: boolean // a .synced.srt the app exported
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

// The subtitle line on screen now, as the overlay draws it.
export type CueSpan = { text: string; italic: boolean; bold: boolean }
export type Cue = { lines: CueSpan[][]; top: boolean }

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

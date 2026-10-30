// Player shapes shared by main and the overlay.

export type TrackKind = 'plain' | 'forced' | 'sdh' | 'commentary'

// How a chosen track is remembered: track ids differ between files, so match by these.
export type TrackRef = { lang: string | null; kind: TrackKind; title: string | null }

// Remembered per title (movie or whole show), never app-wide.
export type TitlePrefs = { volume: number; audio: TrackRef | null; subtitle: TrackRef | 'off' | null }

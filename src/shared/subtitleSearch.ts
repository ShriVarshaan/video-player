// One downloadable subtitle file from an online search.
export type SubtitleResult = {
  fileId: number
  language: string // ISO 639-2/B, as mpv names it
  release: string
  hashMatch: boolean // timed for this exact file
  sdh: boolean
  forced: boolean
  downloads: number
  format: string
}

// The only web addresses the app opens. The renderer asks by id, so it can never open anything else.
export const LINKS = {
  tmdbSignup: 'https://www.themoviedb.org/signup',
  tmdbApiSettings: 'https://www.themoviedb.org/settings/api',
  openSubtitlesSignup: 'https://www.opensubtitles.com/en/users/sign_up',
  openSubtitlesConsumers: 'https://www.opensubtitles.com/en/consumers',
  repo: 'https://github.com/ShriVarshaan/video-player',
  mpvSource: 'https://github.com/shinchiro/mpv-winbuild-cmake/releases/tag/20261021',
  ffmpegSource: 'https://github.com/BtbN/FFmpeg-Builds/releases/tag/autobuild-2026-10-29-19-17',
  tmdb: 'https://www.themoviedb.org/'
} as const

export type LinkId = keyof typeof LINKS

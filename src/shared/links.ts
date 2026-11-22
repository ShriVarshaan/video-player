// The only web addresses the app opens. The renderer asks by id, so it can never open anything else.
export const LINKS = {
  tmdbSignup: 'https://www.themoviedb.org/signup',
  tmdbApiSettings: 'https://www.themoviedb.org/settings/api',
  openSubtitlesSignup: 'https://www.opensubtitles.com/en/users/sign_up',
  openSubtitlesConsumers: 'https://www.opensubtitles.com/en/consumers',
  repo: 'https://github.com/ShriVarshaan/video-player',
  // Our own copy of the exact mpv and FFmpeg builds and their source (vendor/manifest.json's mirror).
  thirdPartySource: 'https://github.com/ShriVarshaan/video-player/releases/tag/third-party-2026-11',
  tmdb: 'https://www.themoviedb.org/'
} as const

export type LinkId = keyof typeof LINKS

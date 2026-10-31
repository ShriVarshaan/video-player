// The one source of truth for renderer ↔ main IPC. Add a method here and to
// apiMethods; the compiler then points at the missing handler and bridge.

import type { LibraryFolder, MetadataStatus, MovieItem, ScanProgress, ShowDetail, ShowItem, TitleDetail, WallItem } from './library'
import type { Cue, NextEpisode, PlayerCommand, PlayerState } from './player'
import type { SubtitleResult } from './subtitleSearch'
import type { SubtitleStyle } from './subtitleStyle'

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json }

export type BinaryName = 'mpv' | 'ffmpeg' | 'ffprobe'

export type AppInfo = {
  version: string
  userDataPath: string
  dbPath: string
  binaries: Record<BinaryName, { path: string; exists: boolean }>
}

export type API = {
  app: {
    getInfo: (params: Record<string, never>) => Promise<AppInfo>
  }
  settings: {
    get: (params: { key: string }) => Promise<Json | null>
    set: (params: { key: string; value: Json }) => Promise<void>
  }
  library: {
    // Opens the folder picker in main; null when the user cancels.
    addFolder: (params: Record<string, never>) => Promise<LibraryFolder | null>
    removeFolder: (params: { id: number }) => Promise<void>
    listFolders: (params: Record<string, never>) => Promise<LibraryFolder[]>
    rescan: (params: Record<string, never>) => Promise<void>
    list: (params: Record<string, never>) => Promise<{ movies: MovieItem[]; shows: ShowItem[] }>
    getShow: (params: { key: string }) => Promise<ShowDetail | null>
    // Home wall tiles, already in wall order.
    wall: (params: Record<string, never>) => Promise<WallItem[]>
    // The title page: a movie ('movie:<videoId>') or a show key.
    getTitle: (params: { key: string }) => Promise<TitleDetail | null>
  }
  metadata: {
    setTmdbKey: (params: { key: string }) => Promise<void>
    status: (params: Record<string, never>) => Promise<MetadataStatus>
  }
  player: {
    // Plays a title in the app window. Without videoId, plays the title page's main button.
    play: (params: { key: string; videoId?: number; from?: 'resume' | 'start' }) => Promise<void>
    // Saves the position and closes to the title page (player.closed).
    stop: (params: Record<string, never>) => Promise<void>
    command: (params: PlayerCommand) => Promise<void>
  }
  subtitles: {
    // The global style, and a title's own changes when key is given.
    getStyle: (params: { key?: string }) => Promise<{ global: SubtitleStyle; overrides: Partial<SubtitleStyle> }>
    // From Settings: always global.
    setGlobalStyle: (params: { style: SubtitleStyle }) => Promise<void>
    // From the player: only this title (movie or whole show).
    setTitleStyle: (params: { key: string; patch: Partial<SubtitleStyle> }) => Promise<void>
    // "Use for all movies and shows": the title's look becomes global.
    useForAll: (params: { key: string }) => Promise<void>
    // "Reset to my global style".
    resetTitle: (params: { key: string }) => Promise<void>
    getSettings: (params: Record<string, never>) => Promise<SubtitleSettings>
    setSettings: (params: Partial<SubtitleSettings>) => Promise<void>
    // OpenSubtitles, for the playing video only; nothing is sent until the user asks.
    search: (params: { language?: string }) => Promise<{ results: SubtitleResult[]; remaining: number | null }>
    // Downloads a result, saves it next to the video and shows it.
    download: (params: { fileId: number }) => Promise<{ remaining: number | null }>
    // Never returns the API key or password.
    accountStatus: (params: Record<string, never>) => Promise<{ configured: boolean; username: string | null }>
    setAccount: (params: { apiKey: string; username: string; password: string }) => Promise<void>
    testAccount: (params: Record<string, never>) => Promise<{ username: string; remaining: number }>
    // Timing of the showing subtitle (milestone 6). offset null: no subtitle showing.
    nudge: (params: { deltaS: number }) => Promise<{ offset: number | null }>
    resetTiming: (params: Record<string, never>) => Promise<void>
    // The showing text subtitle's lines, for "Sync to a line" (embedded ones may take a moment).
    // key: the subtitle these lines belong to (Track.key); the calls below refuse another one.
    syncCues: (params: Record<string, never>) => Promise<{ cues: { start: number; text: string }[]; offset: number; key: string }>
    // The line starting at start is being heard now.
    syncToCue: (params: { start: number; key: string }) => Promise<{ offset: number | null }>
    // Writes <video>.<lang>.synced.srt and shows it; { exists } asks before replacing. Names, not paths.
    exportSynced: (params: { replace: boolean; key: string }) => Promise<{ saved: string; fallback: boolean } | { exists: string }>
  }
}

// Subtitle language (ISO 639-2/B, as mpv names it) and whether SDH is preferred.
export type SubtitleSettings = { language: string; preferSdh: boolean }

export type Domain = keyof API

// Runtime list of methods. The mapped type makes leaving one out a compile error.
export const apiMethods: { [D in Domain]: { [M in keyof API[D]]: true } } = {
  app: { getInfo: true },
  settings: { get: true, set: true },
  library: { addFolder: true, removeFolder: true, listFolders: true, rescan: true, list: true, getShow: true, wall: true, getTitle: true },
  metadata: { setTmdbKey: true, status: true },
  player: { play: true, stop: true, command: true },
  subtitles: {
    getStyle: true,
    setGlobalStyle: true,
    setTitleStyle: true,
    useForAll: true,
    resetTitle: true,
    getSettings: true,
    setSettings: true,
    search: true,
    download: true,
    accountStatus: true,
    setAccount: true,
    testAccount: true,
    nudge: true,
    resetTiming: true,
    syncCues: true,
    syncToCue: true,
    exportSynced: true
  }
}

export const channelFor = (domain: string, method: string): string => `vp:${domain}.${method}`

// Main → renderer notifications.
export type ApiEvents = {
  'library.progress': ScanProgress
  'library.changed': Record<string, never>
  'player.state': PlayerState
  // A file played to its end; next is the episode that autoplays after the countdown.
  'player.ended': { next: NextEpisode | null }
  // The player closed; the main window shows this title's page.
  'player.closed': { titleKey: string }
  'player.error': { message: string }
  // The subtitle line on screen now (null: none), drawn by the overlay.
  'subtitles.cue': Cue | null
  // The playing title's effective subtitle style.
  'subtitles.style': SubtitleStyle
  // The showing subtitle's timing fix in seconds (null: no subtitle showing).
  'subtitles.timing': { offset: number } | null
}

export const eventChannel = (name: keyof ApiEvents): string => `vp:event.${name}`

// What the preload exposes as window.api.
export type RendererApi = API & {
  on<K extends keyof ApiEvents>(event: K, callback: (payload: ApiEvents[K]) => void): () => void
}

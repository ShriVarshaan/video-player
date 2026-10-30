// The one source of truth for renderer ↔ main IPC. Add a method here and to
// apiMethods; the compiler then points at the missing handler and bridge.

import type { LibraryFolder, MetadataStatus, MovieItem, ScanProgress, ShowDetail, ShowItem, TitleDetail, WallItem } from './library'
import type { NextEpisode, PlayerCommand, PlayerState } from './player'

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
}

export type Domain = keyof API

// Runtime list of methods. The mapped type makes leaving one out a compile error.
export const apiMethods: { [D in Domain]: { [M in keyof API[D]]: true } } = {
  app: { getInfo: true },
  settings: { get: true, set: true },
  library: { addFolder: true, removeFolder: true, listFolders: true, rescan: true, list: true, getShow: true, wall: true, getTitle: true },
  metadata: { setTmdbKey: true, status: true },
  player: { play: true, stop: true, command: true }
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
}

export const eventChannel = (name: keyof ApiEvents): string => `vp:event.${name}`

// What the preload exposes as window.api.
export type RendererApi = API & {
  on<K extends keyof ApiEvents>(event: K, callback: (payload: ApiEvents[K]) => void): () => void
}

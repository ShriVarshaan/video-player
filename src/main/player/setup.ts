import { join } from 'node:path'
import { app, ipcMain, type BrowserWindow } from 'electron'
import { normalizeLang } from '@shared/lang'
import type { Db } from '../db'
import { broadcast } from '../broadcast'
import { registerDomain } from '../ipc'
import { binaryPath } from '../paths'
import { ensureUtf8 } from '../subtitles/decode'
import { findSubtitles } from '../subtitles/match'
import { createStyleStore, type StyleStore } from '../subtitles/styleStore'
import { launchMpv } from './launch'
import { createOverlay } from './overlay'
import { createPlayerService, type PlayerService } from './service'

// Wires the player into the main window: mpv draws inside it, the overlay floats over it.
export function setupPlayer(opts: {
  db: Db
  binaryBase: string
  userDataPath: string
  main: BrowserWindow
  loadOverlay: (w: BrowserWindow) => void
  webPreferences: Electron.WebPreferences
}): { player: PlayerService; styles: StyleStore } {
  const { main } = opts
  const overlay = createOverlay(main, opts.loadOverlay, opts.webPreferences)
  const styles = createStyleStore(opts.db, { now: Date.now, defaultLanguage: normalizeLang(app.getLocale()) ?? 'eng' })
  const decoded = join(opts.userDataPath, 'cache', 'subtitles')
  const player = createPlayerService({
    db: opts.db,
    launch: () => launchMpv({ mpvPath: binaryPath('mpv', opts.binaryBase), hwnd: main.getNativeWindowHandle().readBigUInt64LE(0) }),
    emit: broadcast,
    window: { setFullScreen: (on) => main.setFullScreen(on), isFullScreen: () => main.isFullScreen() },
    overlay,
    now: Date.now,
    subtitles: { find: findSubtitles, load: (s) => ensureUtf8(s.path, decoded, s.lang), userData: opts.userDataPath },
    styles
  })
  registerDomain(ipcMain, 'player', player)
  return { player, styles }
}

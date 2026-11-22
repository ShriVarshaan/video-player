import { join } from 'node:path'
import { app, ipcMain, screen, type BrowserWindow } from 'electron'
import { normalizeLang } from '@shared/lang'
import type { Db } from '../db'
import { broadcast } from '../broadcast'
import { registerDomain } from '../ipc'
import { binaryPath } from '../paths'
import { createSettings } from '../settings'
import { ensureUtf8 } from '../subtitles/decode'
import { extractSubtitle } from '../subtitles/extract'
import { findSubtitles } from '../subtitles/match'
import { readSubtitleFile } from '../subtitles/parse'
import { createStyleStore, type StyleStore } from '../subtitles/styleStore'
import { launchMpv } from './launch'
import { createOverlay } from './overlay'
import type { Rect } from './pip'
import { createPipWindow } from './pipWindow'
import { createFrameToggle } from './win32Frame'
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
  const hwnd = main.getNativeWindowHandle().readBigUInt64LE(0)
  const settings = createSettings(opts.db)
  const PIP_KEY = 'player.pipBounds'
  const pip = createPipWindow({
    win: {
      getBounds: () => main.getBounds(),
      setBounds: (r) => main.setBounds(r),
      isMaximized: () => main.isMaximized(),
      maximize: () => main.maximize(),
      unmaximize: () => main.unmaximize(),
      isFullScreen: () => main.isFullScreen(),
      setFullScreen: (on) => main.setFullScreen(on),
      leftFullScreen: () =>
        new Promise<void>((resolve) => {
          const timer = setTimeout(done, 1000)
          function done() {
            clearTimeout(timer)
            main.off('leave-full-screen', done)
            resolve()
          }
          main.once('leave-full-screen', done)
        }),
      setAlwaysOnTop: (on) => main.setAlwaysOnTop(on, 'floating')
    },
    frame: createFrameToggle(hwnd),
    overlay,
    workAreas: () => screen.getAllDisplays().map((d) => d.workArea),
    workAreaFor: (r) => screen.getDisplayMatching(r).workArea,
    load: async () => (await settings.get({ key: PIP_KEY })) as Rect | null,
    save: (r) => void settings.set({ key: PIP_KEY, value: r })
  })
  const decoded = join(opts.userDataPath, 'cache', 'subtitles')
  const extracted = join(decoded, 'extracted')
  const player = createPlayerService({
    db: opts.db,
    launch: () => launchMpv({ mpvPath: binaryPath('mpv', opts.binaryBase), hwnd }),
    emit: broadcast,
    window: { setFullScreen: (on) => main.setFullScreen(on), isFullScreen: () => main.isFullScreen() },
    overlay,
    pip,
    now: Date.now,
    subtitles: {
      find: findSubtitles,
      load: (s) => ensureUtf8(s.path, decoded, s.lang),
      userData: opts.userDataPath,
      cues: async (src) => {
        if (src.kind === 'file') return readSubtitleFile(src.path, src.lang)
        const path = await extractSubtitle({ ffmpegPath: binaryPath('ffmpeg', opts.binaryBase), cacheDir: extracted, ...src })
        return readSubtitleFile(path, null)
      }
    },
    styles
  })
  registerDomain(ipcMain, 'player', player)
  return { player, styles }
}

import { ipcMain, type BrowserWindow } from 'electron'
import type { Db } from '../db'
import { broadcast } from '../broadcast'
import { registerDomain } from '../ipc'
import { binaryPath } from '../paths'
import { launchMpv } from './launch'
import { createOverlay } from './overlay'
import { createPlayerService, type PlayerService } from './service'

// Wires the player into the main window: mpv draws inside it, the overlay floats over it.
export function setupPlayer(opts: {
  db: Db
  binaryBase: string
  main: BrowserWindow
  loadOverlay: (w: BrowserWindow) => void
  webPreferences: Electron.WebPreferences
}): PlayerService {
  const { main } = opts
  const overlay = createOverlay(main, opts.loadOverlay, opts.webPreferences)
  const player = createPlayerService({
    db: opts.db,
    launch: () => launchMpv({ mpvPath: binaryPath('mpv', opts.binaryBase), hwnd: main.getNativeWindowHandle().readBigUInt64LE(0) }),
    emit: broadcast,
    window: { setFullScreen: (on) => main.setFullScreen(on), isFullScreen: () => main.isFullScreen() },
    overlay,
    now: Date.now
  })
  registerDomain(ipcMain, 'player', player)
  return player
}

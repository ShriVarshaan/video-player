import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron'
import { version } from '../../package.json'
import { createAppInfo } from './appInfo'
import { openDb, type Db } from './db'
import { createFirstRun } from './firstRun'
import { systemHour12 } from './hour12'
import { registerDomain } from './ipc'
import { listFolders } from './library/queries'
import { registerPosterScheme, setupLibrary } from './library/setup'
import type { LibraryService } from './library/service'
import { killAllMpv } from './player/launch'
import { setupPlayer } from './player/setup'
import { setupSubtitles } from './subtitles/setup'
import type { PlayerService } from './player/service'
import { binaryPath, sidecarCommand, userDataDir } from './paths'
import { createSettings } from './settings'
import { startOrQuit } from './startup'
import { createSidecar, type Sidecar } from './sync/sidecar'
import { setupUpdates } from './updates/setup'

// Must run before 'ready' (and the single-instance lock) so everything sees it.
app.setPath('userData', userDataDir(process.argv, app.getPath('appData')))
registerPosterScheme()

let db: Db | null = null
let library: LibraryService | null = null
let mainWindow: BrowserWindow | null = null
let player: PlayerService | null = null
let sidecar: Sidecar | null = null

// One process per userData dir, so two instances never open the database at once.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })
  void app.whenReady().then(() =>
    startOrQuit(start, {
      report: (message) => dialog.showErrorBox('Cinewall', message),
      quit: () => app.quit()
    })
  )
}

const webPreferences: Electron.WebPreferences = {
  preload: join(__dirname, '../preload/index.js'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true
}

// Stay on the app page: a dropped file or a link must not replace the UI
// (the preload, and so window.api, would run on whatever loaded instead).
function guard(win: BrowserWindow): void {
  win.webContents.on('will-navigate', (event) => event.preventDefault())
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-attach-webview', (event) => event.preventDefault())
}

// page is 'index' (the app) or 'overlay' (the player controls).
function loadPage(win: BrowserWindow, page: 'index' | 'overlay'): void {
  guard(win)
  const devUrl = !app.isPackaged ? process.env['ELECTRON_RENDERER_URL'] : undefined
  if (devUrl) {
    void win.loadURL(page === 'index' ? devUrl : `${devUrl}/overlay.html`)
  } else {
    void win.loadFile(join(__dirname, `../renderer/${page}.html`))
  }
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#0b0b0c',
    show: false,
    webPreferences
  })
  win.once('ready-to-show', () => win.show())
  loadPage(win, 'index')
  return win
}

function start(): void {
  // No default menu. Its bar (File, Edit, View…) sits inside the client area that mpv fills,
  // and content bounds start below it, updating late when it shows or hides: the overlay and
  // mpv's window would no longer match. Its shortcuts would also act on the overlay while
  // playing (Ctrl+R reloads the controls, F11 fullscreens them alone).
  Menu.setApplicationMenu(null)
  const userDataPath = app.getPath('userData')
  const dbPath = join(userDataPath, 'library.db')
  db = openDb(dbPath)

  // In development vendor/ is in the project root, two levels above out/main.
  // (getAppPath() is out/main when Electron is launched with a file path.)
  const binaryBase = app.isPackaged ? process.resourcesPath : join(__dirname, '..', '..')
  // Unpackaged, app.getVersion() reports Electron's version when launched by file path. Packaged,
  // it's what the updater compares, so the two can't disagree.
  const appVersion = app.isPackaged ? app.getVersion() : version
  const settings = createSettings(db)
  const database = db
  registerDomain(ipcMain, 'app', {
    ...createAppInfo({
      version: appVersion,
      userDataPath,
      dbPath,
      packaged: app.isPackaged,
      resolve: (name) => binaryPath(name, binaryBase),
      exists: existsSync,
      hour12: systemHour12,
      readNotices: () => readFile(join(binaryBase, 'THIRD_PARTY_NOTICES.md'), 'utf8')
    }),
    ...createFirstRun({
      settings,
      folderCount: () => listFolders(database, existsSync).length,
      disabled: !app.isPackaged && process.env['VP_FIRST_RUN'] === 'off',
      openExternal: (url) => shell.openExternal(url)
    })
  })
  registerDomain(ipcMain, 'settings', settings)
  setupUpdates(settings, () => player?.current() != null)
  library = setupLibrary({
    db,
    userDataPath,
    binaryBase,
    devRoot: app.isPackaged ? null : join(__dirname, '..', '..'),
    getWindow: () => mainWindow
  })

  const main = createWindow()
  mainWindow = main
  const playback = setupPlayer({ db, binaryBase, userDataPath, main, loadOverlay: (w) => loadPage(w, 'overlay'), webPreferences })
  player = playback.player
  // Auto sync's Python helper: started on the first sync, not now.
  sidecar = createSidecar({ command: sidecarCommand(binaryBase, app.isPackaged, existsSync), ffmpeg: binaryPath('ffmpeg', binaryBase) })
  setupSubtitles({ db, ...playback, userDataPath, devRoot: app.isPackaged ? null : join(__dirname, '..', '..'), version: appVersion, sidecar })
  // Closing the window mid-film saves the position and stops mpv first.
  let saved = false
  main.on('close', (event) => {
    if (saved || !player) return
    event.preventDefault()
    void player
      .shutdown()
      .catch((e: unknown) => console.error('Saving playback failed:', e))
      .finally(() => {
        saved = true
        main.close()
      })
  })
  main.on('closed', () => {
    mainWindow = null
  })

  // Catch up on changes made while the app was closed, then keep watching.
  library.startWatching()
  library.rescan().catch((e: unknown) => console.error('Startup rescan failed:', e))
}

app.on('window-all-closed', () => app.quit())

// Last resort: if the main process goes down any other way, take mpv with it.
process.on('exit', killAllMpv)

app.on('will-quit', () => {
  library?.stopWatching()
  sidecar?.dispose()
  db?.close()
  db = null
})

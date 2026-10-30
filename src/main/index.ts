import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { version } from '../../package.json'
import { createAppInfo } from './appInfo'
import { openDb, type Db } from './db'
import { registerDomain } from './ipc'
import { registerPosterScheme, setupLibrary } from './library/setup'
import type { LibraryService } from './library/service'
import { setupPlayer } from './player/setup'
import type { PlayerService } from './player/service'
import { binaryPath, userDataDir } from './paths'
import { createSettings } from './settings'
import { startOrQuit } from './startup'

// Must run before 'ready' (and the single-instance lock) so everything sees it.
app.setPath('userData', userDataDir(process.argv, app.getPath('appData')))
registerPosterScheme()

let db: Db | null = null
let library: LibraryService | null = null
let mainWindow: BrowserWindow | null = null
let player: PlayerService | null = null

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
      report: (message) => dialog.showErrorBox('Video Player', message),
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
  const userDataPath = app.getPath('userData')
  const dbPath = join(userDataPath, 'library.db')
  db = openDb(dbPath)

  // In development vendor/ is in the project root, two levels above out/main.
  // (getAppPath() is out/main when Electron is launched with a file path.)
  const binaryBase = app.isPackaged ? process.resourcesPath : join(__dirname, '..', '..')
  registerDomain(
    ipcMain,
    'app',
    createAppInfo({
      // Not app.getVersion(): that reports Electron's version when launched by file path.
      version,
      userDataPath,
      dbPath,
      resolve: (name) => binaryPath(name, binaryBase),
      exists: existsSync
    })
  )
  registerDomain(ipcMain, 'settings', createSettings(db))
  library = setupLibrary({
    db,
    userDataPath,
    binaryBase,
    devRoot: app.isPackaged ? null : join(__dirname, '..', '..'),
    getWindow: () => mainWindow
  })

  const main = createWindow()
  mainWindow = main
  player = setupPlayer({ db, binaryBase, main, loadOverlay: (w) => loadPage(w, 'overlay'), webPreferences })
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

app.on('will-quit', () => {
  library?.stopWatching()
  db?.close()
  db = null
})

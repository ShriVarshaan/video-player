import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { parseAppError } from '@shared/appError'
import { version } from '../../package.json'
import { createAppInfo } from './appInfo'
import { openDb, type Db } from './db'
import { registerDomain } from './ipc'
import { binaryPath, userDataDir } from './paths'
import { createSettings } from './settings'

// Must run before 'ready' (and the single-instance lock) so everything sees it.
app.setPath('userData', userDataDir(process.argv, app.getPath('appData')))

let db: Db | null = null
let mainWindow: BrowserWindow | null = null

// One process per userData dir, so two instances never open the database at once.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })
  void app.whenReady().then(start)
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#0b0b0c',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  win.once('ready-to-show', () => win.show())

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

function start(): void {
  const userDataPath = app.getPath('userData')
  const dbPath = join(userDataPath, 'library.db')
  try {
    db = openDb(dbPath)
  } catch (e) {
    dialog.showErrorBox('Video Player', parseAppError(e)?.message ?? String(e))
    app.quit()
    return
  }

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

  mainWindow = createWindow()
  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.on('window-all-closed', () => app.quit())

app.on('will-quit', () => {
  db?.close()
  db = null
})

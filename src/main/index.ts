import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { parseAppError } from '@shared/appError'
import { createAppInfo } from './appInfo'
import { openDb, type Db } from './db'
import { registerDomain } from './ipc'
import { binaryPath, userDataOverride } from './paths'
import { createSettings } from './settings'

// Must run before 'ready' so every later getPath('userData') sees it.
const userDataDir = userDataOverride(process.argv)
if (userDataDir) app.setPath('userData', userDataDir)

let db: Db | null = null

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

void app.whenReady().then(() => {
  const userDataPath = app.getPath('userData')
  const dbPath = join(userDataPath, 'library.db')
  try {
    db = openDb(dbPath)
  } catch (e) {
    dialog.showErrorBox('Video Player', parseAppError(e)?.message ?? String(e))
    app.quit()
    return
  }

  // In development getAppPath() is the project root, where vendor/ lives.
  const binaryBase = app.isPackaged ? process.resourcesPath : app.getAppPath()
  registerDomain(
    ipcMain,
    'app',
    createAppInfo({
      version: app.getVersion(),
      userDataPath,
      dbPath,
      resolve: (name) => binaryPath(name, binaryBase),
      exists: existsSync
    })
  )
  registerDomain(ipcMain, 'settings', createSettings(db))

  createWindow()
})

app.on('window-all-closed', () => app.quit())

app.on('will-quit', () => {
  db?.close()
  db = null
})

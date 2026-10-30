/// <reference lib="dom" />
/// <reference path="../../src/preload/index.d.ts" />
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { goTo, overlayPage } from './pages'

const LIBRARY = resolve('tests', 'fixtures', 'library')
let userData: string
let app: ElectronApplication
let win: Page
const cleanup: string[] = []

async function launch(folder: string | null, keepUserData = false) {
  if (!keepUserData) userData = mkdtempSync(join(tmpdir(), 'vp-e2e-player-'))
  app = await electron.launch({
    args: ['out/main/index.js', `--user-data-dir=${userData}`],
    env: { ...process.env, VP_TMDB_MODE: 'fixtures' }
  })
  win = await app.firstWindow()
  if (!folder) return
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as typeof dialog.showOpenDialog
  }, folder)
  await goTo(win, 'Settings')
  await win.getByLabel('TMDB API key or read access token').fill('test-key')
  await win.getByRole('button', { name: 'Save key' }).click()
  await win.getByRole('button', { name: 'Add folder' }).click()
  await expect(win.getByTestId('folder-row')).toHaveCount(1)
  await goTo(win, 'Home')
}

// The wall key of a title, once the library has it.
async function keyOf(title: string): Promise<string> {
  let key: string | undefined
  await expect
    .poll(async () => {
      key = await win.evaluate(async (t) => (await window.api.library.wall({})).find((i) => i.title === t)?.key, title)
      return key
    })
    .toBeTruthy()
  return key!
}

const play = (key: string) => win.evaluate((k) => window.api.player.play({ key: k }), key)
const position = (overlay: Page) => overlay.getByTestId('player-time').evaluate((el) => Number((el as HTMLElement).dataset['position']))
const mpvCount = () => (execFileSync('tasklist', ['/FI', 'IMAGENAME eq mpv.exe', '/NH'], { encoding: 'utf8' }).match(/mpv\.exe/g) ?? []).length
const overlayVisible = () =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w.webContents.getURL().endsWith('overlay.html') && w.isVisible()))

// Close the window the way a user does (✕ / Alt+F4). Playwright's app.close() detaches
// its debugger mid-shutdown, which stalls the main process while mpv is quitting.
async function closeApp() {
  const closed = app.waitForEvent('close', { timeout: 15_000 }).catch(() => null)
  await app
    .evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => !w.webContents.getURL().endsWith('overlay.html'))?.close())
    .catch(() => {})
  if (!(await closed)) await app.close().catch(() => {})
}

test.afterEach(async () => {
  await closeApp()
  rmSync(userData, { recursive: true, force: true })
  for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true })
})

test('plays inside the app window', async () => {
  await launch(LIBRARY)
  await play(await keyOf('The Matrix'))
  const overlay = await overlayPage(app)
  await expect(overlay.getByTestId('player-heading')).toHaveText('The Matrix')
  await expect.poll(() => position(overlay), { timeout: 8000 }).toBeGreaterThan(2)
  expect(app.windows()).toHaveLength(2)
})

test('keeps the overlay over the content area', async () => {
  await launch(LIBRARY)
  await play(await keyOf('The Matrix'))
  await overlayPage(app)
  const aligned = () =>
    app.evaluate(({ BrowserWindow }) => {
      const all = BrowserWindow.getAllWindows()
      const overlay = all.find((w) => w.webContents.getURL().endsWith('overlay.html'))!
      const main = all.find((w) => w !== overlay)!
      const a = overlay.getBounds()
      const b = main.getContentBounds()
      // At 125 % scaling Windows rounds the two by up to a pixel apart.
      return [a.x - b.x, a.y - b.y, a.width - b.width, a.height - b.height].every((d) => Math.abs(d) <= 1)
    })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => !w.webContents.getURL().endsWith('overlay.html'))!.setSize(1100, 700))
  await expect.poll(aligned).toBe(true)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => !w.webContents.getURL().endsWith('overlay.html'))!.maximize())
  await expect.poll(aligned).toBe(true)
})

test('closes to the title and saves the position', async () => {
  await launch(LIBRARY)
  const key = await keyOf('The Matrix')
  await play(key)
  const overlay = await overlayPage(app)
  await expect.poll(() => position(overlay), { timeout: 8000 }).toBeGreaterThan(3)
  await overlay.getByTestId('player-close').click()
  await expect.poll(overlayVisible).toBe(false)
  const title = await win.evaluate((k) => window.api.library.getTitle({ key: k }), key)
  expect(title!.main.label).toBe('Continue watching')
})

test('saves the position when the app is closed during playback', async () => {
  const before = mpvCount()
  await launch(LIBRARY)
  const key = await keyOf('The Matrix')
  await play(key)
  const overlay = await overlayPage(app)
  await expect.poll(() => position(overlay), { timeout: 8000 }).toBeGreaterThan(3)
  await closeApp()
  await expect.poll(mpvCount).toBe(before)
  await launch(null, true)
  const title = await win.evaluate((k) => window.api.library.getTitle({ key: k }), key)
  expect(title!.main.label).toBe('Continue watching')
})

test("shows Can't play this file for a broken file", async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vp-e2e-broken-'))
  cleanup.push(dir)
  copyFileSync(resolve('tests', 'fixtures', 'media', 'truncated.mp4'), join(dir, 'Broken Film (2001).mp4'))
  await launch(dir)
  await play(await keyOf('Broken Film'))
  const overlay = await overlayPage(app)
  await expect(overlay.getByTestId('player-error')).toHaveText("Can't play this file")
  await overlay.getByTestId('player-close').click()
  await expect.poll(overlayVisible).toBe(false)
})

/// <reference lib="dom" />
/// <reference path="../../src/preload/index.d.ts" />
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test'

// Opens the top-left menu and picks a page: 'Search' | 'Home' | 'Settings'.
export async function goTo(win: Page, name: 'Search' | 'Home' | 'Settings') {
  await win.getByRole('button', { name: 'Menu' }).click()
  await win.getByRole('navigation', { name: 'Main' }).getByRole('button', { name }).click()
}

// Titles of every wall tile currently showing a title.
export const wallTitles = (win: Page) =>
  win.evaluate(() => [...new Set([...document.querySelectorAll<HTMLElement>('[data-testid="wall-tile"]:not([hidden])')].map((t) => t.dataset.title))])

// Clicks the first tile that is fully on screen and returns its title.
export async function clickAnyTile(win: Page): Promise<string> {
  const hit = await win.evaluate(() => {
    for (const t of document.querySelectorAll<HTMLElement>('[data-testid="wall-tile"]:not([hidden])')) {
      const r = t.getBoundingClientRect()
      if (r.left > 64 && r.top > 64 && r.right < innerWidth && r.bottom < innerHeight) {
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, title: t.dataset.title! }
      }
    }
    return null
  })
  if (!hit) throw new Error('no fully visible tile')
  await win.mouse.click(hit.x, hit.y)
  return hit.title
}

// Moves focus right until the title is focused (a row cycles through every title);
// its info card shows once focus rests.
export async function focusTile(win: Page, title: string) {
  const live = win.getByTestId('wall-live')
  for (let i = 0; i < 12 && !(await live.textContent())?.startsWith(title); i++) await win.keyboard.press('ArrowRight')
  if (!(await live.textContent())?.startsWith(title)) throw new Error(`could not focus ${title}`)
}

// Focuses the title on the wall and opens its title page.
export async function openTile(win: Page, title: string) {
  await focusTile(win, title)
  await win.keyboard.press('Enter')
  await expect(win.getByTestId('title-page')).toBeVisible()
}

// The player's overlay window (controls), once it has opened.
export async function overlayPage(app: ElectronApplication): Promise<Page> {
  const existing = app.windows().find((w) => w.url().endsWith('overlay.html'))
  if (existing) return existing
  return app.waitForEvent('window', { predicate: (w) => w.url().endsWith('overlay.html') })
}

export const overlayVisible = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w.webContents.getURL().endsWith('overlay.html') && w.isVisible()))

export const isFullScreen = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w.isFullScreen()))

// Where the overlay and mpv's own window really are on screen, in physical pixels, read
// from Windows: Electron's bounds can't see mpv, which fills the main window's whole client area.
export const overlayAndVideoRects = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }, koffiPath) => {
    const koffi = (process as unknown as { mainModule: NodeJS.Module }).mainModule.require(koffiPath)
    const user32 = koffi.load('user32.dll')
    const rectType = koffi.struct(`VpRect${Date.now()}`, { left: 'int', top: 'int', right: 'int', bottom: 'int' })
    const getRect = user32.func(`bool __stdcall GetWindowRect(intptr h, _Out_ ${koffi.pointer(rectType).name} r)`)
    const findChild = user32.func('intptr __stdcall FindWindowExW(intptr parent, intptr after, str16 cls, str16 name)')
    const rect = (h: bigint | number) => {
      const r = { left: 0, top: 0, right: 0, bottom: 0 }
      getRect(h, r)
      return `${r.left},${r.top} ${r.right - r.left}x${r.bottom - r.top}`
    }
    const windows = BrowserWindow.getAllWindows()
    const isOverlay = (w: Electron.BrowserWindow) => w.webContents.getURL().endsWith('overlay.html')
    const handle = (w: Electron.BrowserWindow) => w.getNativeWindowHandle().readBigUInt64LE()
    const mpv = findChild(handle(windows.find((w) => !isOverlay(w))!), 0n, 'mpv', null)
    return { overlay: rect(handle(windows.find(isOverlay)!)), video: rect(mpv) }
  }, join(process.cwd(), 'node_modules', 'koffi'))

// Closes the player with its ✕; Esc doesn't close it. Faded controls take no clicks, so the mouse moves first.
export async function closeWithX(overlay: Page) {
  await overlay.mouse.move(200, 200)
  await overlay.getByTestId('player-close').click()
}

// Seconds into the playing file, as the overlay shows it.
export const position = (overlay: Page) =>
  overlay.getByTestId('player-time').evaluate((el) => Number((el as HTMLElement).dataset['position']))

// Keeps test windows off the primary display when there is another one, so test runs
// don't cover the user's work. Every window moves: at first the overlay's URL is still
// empty, so it can't be told from the main window (it re-fits the main one when shown).
export async function toSecondDisplay(app: ElectronApplication) {
  await app.evaluate(({ BrowserWindow, screen }) => {
    const other = screen.getAllDisplays().find((d) => d.id !== screen.getPrimaryDisplay().id)
    if (!other) return
    const { x, y, width, height } = other.workArea
    for (const win of BrowserWindow.getAllWindows()) {
      // setBounds, not setPosition: crossing to a display with another scale would resize it.
      const [w, h] = win.getSize() as [number, number]
      const cw = Math.min(w, width)
      const ch = Math.min(h, height)
      const bounds = { x: Math.round(x + (width - cw) / 2), y: Math.round(y + (height - ch) / 2), width: cw, height: ch }
      win.setBounds(bounds)
      win.setBounds(bounds) // again, now on the new display's scale
    }
  })
}

// The main window. firstWindow() can be the hidden overlay, depending on which loads first.
export async function mainWindow(app: ElectronApplication): Promise<Page> {
  await expect.poll(() => app.windows().some((w) => w.url().endsWith('index.html')), { timeout: 30_000 }).toBe(true)
  return app.windows().find((w) => w.url().endsWith('index.html'))!
}

// Launches the app on a fresh (or given) user-data dir, in TMDB and OpenSubtitles fixture mode, and
// adds the folder through Settings when one is given. First-run setup stays off unless env turns it on.
export async function launchApp(folder: string | null, userData = mkdtempSync(join(tmpdir(), 'vp-e2e-')), env: Record<string, string> = {}) {
  const app = await electron.launch({
    args: ['out/main/index.js', `--user-data-dir=${userData}`],
    env: { ...process.env, VP_TMDB_MODE: 'fixtures', VP_OPENSUBS_MODE: 'fixtures', VP_FIRST_RUN: 'off', ...env }
  })
  const win = await mainWindow(app)
  await toSecondDisplay(app)
  if (folder) {
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
  return { app, win, userData }
}

// Closes the window the way a user does (✕ / Alt+F4). Playwright's app.close() detaches
// its debugger mid-shutdown, which stalls the main process while mpv is quitting.
export async function closeApp(app: ElectronApplication) {
  const closed = app.waitForEvent('close', { timeout: 15_000 }).catch(() => null)
  await app
    .evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => !w.webContents.getURL().endsWith('overlay.html'))?.close())
    .catch(() => {})
  if (!(await closed)) await app.close().catch(() => {})
}

// The wall key of a title, once the library has it.
export async function keyOf(win: Page, title: string): Promise<string> {
  let key: string | undefined
  await expect
    .poll(async () => {
      key = await win.evaluate(async (t) => (await window.api.library.wall({})).find((i) => i.title === t)?.key, title)
      return key
    })
    .toBeTruthy()
  return key!
}

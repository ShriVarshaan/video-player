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

// Seconds into the playing file, as the overlay shows it.
export const position = (overlay: Page) =>
  overlay.getByTestId('player-time').evaluate((el) => Number((el as HTMLElement).dataset['position']))

// Launches the app on a fresh (or given) user-data dir, in TMDB fixture mode, and
// adds the folder through Settings when one is given.
export async function launchApp(folder: string | null, userData = mkdtempSync(join(tmpdir(), 'vp-e2e-'))) {
  const app = await electron.launch({
    args: ['out/main/index.js', `--user-data-dir=${userData}`],
    env: { ...process.env, VP_TMDB_MODE: 'fixtures' }
  })
  const win = await app.firstWindow()
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

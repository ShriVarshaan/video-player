/// <reference lib="dom" />
/// <reference path="../../src/preload/index.d.ts" />
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { closeApp, keyOf, launchApp, overlayPage, overlayVisible, position } from './pages'

const LIBRARY = resolve('tests', 'fixtures', 'library')
let userData: string
let app: ElectronApplication
let win: Page
const cleanup: string[] = []

async function launch(folder: string | null, keepUserData = false) {
  ;({ app, win, userData } = await launchApp(folder, keepUserData ? userData : undefined))
}

const play = (key: string) => win.evaluate((k) => window.api.player.play({ key: k }), key)
const mpvCount = () => (execFileSync('tasklist', ['/FI', 'IMAGENAME eq mpv.exe', '/NH'], { encoding: 'utf8' }).match(/mpv\.exe/g) ?? []).length
const resizeMain = (fn: 'small' | 'max') =>
  app.evaluate(({ BrowserWindow }, how) => {
    const main = BrowserWindow.getAllWindows().find((w) => !w.webContents.getURL().endsWith('overlay.html'))!
    if (how === 'max') main.maximize()
    else main.setSize(1100, 700)
  }, fn)

test.afterEach(async () => {
  await closeApp(app)
  rmSync(userData, { recursive: true, force: true })
  for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true })
})

test('plays inside the app window', async () => {
  await launch(LIBRARY)
  await play(await keyOf(win, 'The Matrix'))
  const overlay = await overlayPage(app)
  await expect(overlay.getByTestId('player-heading')).toHaveText('The Matrix')
  await expect.poll(() => position(overlay), { timeout: 8000 }).toBeGreaterThan(2)
  expect(app.windows()).toHaveLength(2)
})

test('keeps the overlay over the content area', async () => {
  await launch(LIBRARY)
  await play(await keyOf(win, 'The Matrix'))
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
  await resizeMain('small')
  await expect.poll(aligned).toBe(true)
  await resizeMain('max')
  await expect.poll(aligned).toBe(true)
})

test('closes to the title and saves the position', async () => {
  await launch(LIBRARY)
  const key = await keyOf(win, 'The Matrix')
  await play(key)
  const overlay = await overlayPage(app)
  await expect.poll(() => position(overlay), { timeout: 8000 }).toBeGreaterThan(3)
  await overlay.getByTestId('player-close').click()
  await expect.poll(() => overlayVisible(app)).toBe(false)
  const title = await win.evaluate((k) => window.api.library.getTitle({ key: k }), key)
  expect(title!.main.label).toBe('Continue watching')
})

test('saves the position when the app is closed during playback', async () => {
  const before = mpvCount()
  await launch(LIBRARY)
  const key = await keyOf(win, 'The Matrix')
  await play(key)
  const overlay = await overlayPage(app)
  await expect.poll(() => position(overlay), { timeout: 8000 }).toBeGreaterThan(3)
  await closeApp(app)
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
  await play(await keyOf(win, 'Broken Film'))
  const overlay = await overlayPage(app)
  await expect(overlay.getByTestId('player-error')).toHaveText("Can't play this file")
  await overlay.getByTestId('player-close').click()
  await expect.poll(() => overlayVisible(app)).toBe(false)
})

test('Alt+F4 on the controls closes the app and keeps the place', async () => {
  const before = mpvCount()
  await launch(LIBRARY)
  const key = await keyOf(win, 'The Matrix')
  await play(key)
  const overlay = await overlayPage(app)
  await expect.poll(() => position(overlay), { timeout: 8000 }).toBeGreaterThan(3)
  // The controls window has keyboard focus, so Alt+F4 closes it.
  const closed = app.waitForEvent('close', { timeout: 15_000 })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('overlay.html'))!.close())
  await closed
  await expect.poll(mpvCount).toBe(before)
  await launch(null, true)
  const title = await win.evaluate((k) => window.api.library.getTitle({ key: k }), key)
  expect(title!.main.label).toBe('Continue watching')
})

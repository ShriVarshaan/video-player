/// <reference lib="dom" />
/// <reference path="../../src/preload/index.d.ts" />
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { closeApp, closeWithX, isFullScreen, keyOf, launchApp, overlayAndVideoRects, overlayPage, overlayVisible, position } from './pages'

const LIBRARY = resolve('tests', 'fixtures', 'library')
let userData: string
let app: ElectronApplication
let win: Page
const cleanup: string[] = []

test.afterEach(async () => {
  await closeApp(app)
  rmSync(userData, { recursive: true, force: true })
  for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true })
})

async function start(folder = LIBRARY) {
  ;({ app, win, userData } = await launchApp(folder))
}

async function playTitle(title: string, opts: { videoId?: number; from?: 'resume' | 'start' } = {}): Promise<Page> {
  const key = await keyOf(win, title)
  await win.evaluate(([k, o]) => window.api.player.play({ key: k, ...o }), [key, opts] as const)
  const overlay = await overlayPage(app)
  await expect.poll(() => overlayVisible(app)).toBe(true)
  await expect.poll(() => position(overlay), { timeout: 8000 }).toBeGreaterThan(0.5)
  return overlay
}

async function closePlayer(overlay: Page) {
  await closeWithX(overlay)
  await expect.poll(() => overlayVisible(app)).toBe(false)
}

// Playing means the position moves on from where it is now.
async function expectPlaying(overlay: Page) {
  const from = await position(overlay)
  await expect.poll(() => position(overlay)).toBeGreaterThan(from + 0.3)
}

const episodeId = async (title: string, season: number, episode: number) => {
  const key = await keyOf(win, title)
  const t = (await win.evaluate((k) => window.api.library.getTitle({ key: k }), key))!
  return t.seasons.find((s) => s.season === season)!.episodes.find((e) => e.episode === episode)!.videoId
}

test('Esc in fullscreen leaves fullscreen and keeps playing', async () => {
  await start()
  const overlay = await playTitle('The Matrix', { from: 'start' })
  await overlay.keyboard.press('f')
  await expect.poll(() => isFullScreen(app)).toBe(true)
  await overlay.keyboard.press('Escape')
  await expect.poll(() => isFullScreen(app)).toBe(false)
  expect(await overlayVisible(app)).toBe(true)
  await expectPlaying(overlay)
})

test('Esc when not fullscreen does nothing', async () => {
  await start()
  const overlay = await playTitle('The Matrix', { from: 'start' })
  await overlay.keyboard.press('Escape')
  await overlay.waitForTimeout(500)
  expect(await overlayVisible(app)).toBe(true)
  expect(await isFullScreen(app)).toBe(false)
  await expectPlaying(overlay)
})

test('Esc with a menu open in fullscreen closes only the menu', async () => {
  await start()
  const overlay = await playTitle('The Matrix', { from: 'start' })
  await overlay.keyboard.press('f')
  await expect.poll(() => isFullScreen(app)).toBe(true)
  await overlay.mouse.move(200, 200)
  await overlay.getByTestId('subtitles-button').click()
  await expect(overlay.getByTestId('track-menu')).toBeVisible()
  await overlay.keyboard.press('Escape')
  await expect(overlay.getByTestId('track-menu')).toHaveCount(0)
  expect(await isFullScreen(app)).toBe(true)
})

test('Held Esc closes the menu and stays fullscreen', async () => {
  await start()
  const overlay = await playTitle('The Matrix', { from: 'start' })
  await overlay.keyboard.press('f')
  await expect.poll(() => isFullScreen(app)).toBe(true)
  await overlay.mouse.move(200, 200)
  await overlay.getByTestId('subtitles-button').click()
  await expect(overlay.getByTestId('track-menu')).toBeVisible()
  // keyboard.down again without an up is a key repeat.
  for (let i = 0; i < 3; i++) await overlay.keyboard.down('Escape')
  await overlay.keyboard.up('Escape')
  await expect(overlay.getByTestId('track-menu')).toHaveCount(0)
  await overlay.waitForTimeout(300)
  expect(await isFullScreen(app)).toBe(true)
})

test('The controls cover the video exactly, windowed, fullscreen and resized', async () => {
  await start()
  const overlay = await playTitle('The Matrix', { from: 'start' })
  const aligned = async () => {
    const { overlay: o, video } = await overlayAndVideoRects(app)
    return o === video ? 'aligned' : `overlay ${o}, video ${video}`
  }
  await expect.poll(aligned).toBe('aligned')
  await overlay.keyboard.press('f')
  await expect.poll(() => isFullScreen(app)).toBe(true)
  await expect.poll(aligned).toBe('aligned')
  await overlay.keyboard.press('f')
  await expect.poll(() => isFullScreen(app)).toBe(false)
  await expect.poll(aligned).toBe('aligned')
  await app.evaluate(({ BrowserWindow }) => {
    const main = BrowserWindow.getAllWindows().find((w) => !w.webContents.getURL().endsWith('overlay.html'))!
    const [w, h] = main.getSize() as [number, number]
    main.setSize(w - 100, h - 60)
  })
  await expect.poll(aligned).toBe('aligned')
})

test('The window keeps its size after playing, and the page gets back its space', async () => {
  await start()
  const contentHeight = () =>
    app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => !w.webContents.getURL().endsWith('overlay.html'))!.getContentBounds().height)
  const windowSize = () =>
    app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => !w.webContents.getURL().endsWith('overlay.html'))!.getSize())
  const [size, height] = [await windowSize(), await contentHeight()]
  const overlay = await playTitle('The Matrix', { from: 'start' })
  await closePlayer(overlay)
  await expect.poll(contentHeight).toBe(height)
  expect(await windowSize()).toEqual(size)
})

const playLabel = (overlay: Page) => expect(overlay.getByTestId('play-pause'))
async function centre(overlay: Page) {
  const { width, height } = overlay.viewportSize() ?? (await overlay.evaluate(() => ({ width: innerWidth, height: innerHeight })))
  return { x: Math.round(width / 2), y: Math.round(height / 2) }
}

test('Click pauses and click resumes', async () => {
  await start()
  const overlay = await playTitle('The Matrix', { from: 'start' })
  const { x, y } = await centre(overlay)
  await overlay.mouse.click(x, y)
  await playLabel(overlay).toHaveAttribute('aria-label', 'Play')
  await overlay.mouse.click(x, y)
  await playLabel(overlay).toHaveAttribute('aria-label', 'Pause')
  await expectPlaying(overlay)
})

test('Click on the dark strip above the controls pauses', async () => {
  await start()
  const overlay = await playTitle('The Matrix', { from: 'start' })
  await overlay.mouse.move(200, 200)
  const seek = (await overlay.getByTestId('seek').boundingBox())!
  await overlay.mouse.click(seek.x + seek.width / 2, seek.y - 20)
  await playLabel(overlay).toHaveAttribute('aria-label', 'Play')
})

test('Double-click toggles fullscreen and keeps playing', async () => {
  await start()
  const overlay = await playTitle('The Matrix', { from: 'start' })
  const { x, y } = await centre(overlay)
  await overlay.mouse.dblclick(x, y)
  await expect.poll(() => isFullScreen(app)).toBe(true)
  await playLabel(overlay).toHaveAttribute('aria-label', 'Pause')
  await expectPlaying(overlay)
  // Again, back out: faster than mpv reports the pause, it still must not end up paused.
  const c = await centre(overlay)
  await overlay.mouse.dblclick(c.x, c.y)
  await expect.poll(() => isFullScreen(app)).toBe(false)
  await playLabel(overlay).toHaveAttribute('aria-label', 'Pause')
  await expectPlaying(overlay)
})

test('Click with a menu open only closes the menu', async () => {
  await start()
  const overlay = await playTitle('The Matrix', { from: 'start' })
  await overlay.mouse.move(200, 200)
  await overlay.getByTestId('subtitles-button').click()
  await expect(overlay.getByTestId('track-menu')).toBeVisible()
  const { x, y } = await centre(overlay)
  await overlay.mouse.click(x, y)
  await expect(overlay.getByTestId('track-menu')).toHaveCount(0)
  await overlay.waitForTimeout(300)
  await playLabel(overlay).toHaveAttribute('aria-label', 'Pause')
})

test('Clicks on the controls do not also toggle pause', async () => {
  await start()
  const overlay = await playTitle('The Matrix', { from: 'start' })
  await overlay.mouse.move(200, 200)
  await overlay.getByTestId('fullscreen').click()
  await expect.poll(() => isFullScreen(app)).toBe(true)
  await overlay.waitForTimeout(300)
  await playLabel(overlay).toHaveAttribute('aria-label', 'Pause')
})

test('Releasing a volume drag over the video does not pause', async () => {
  await start()
  const overlay = await playTitle('The Matrix', { from: 'start' })
  await overlay.mouse.move(200, 200)
  const slider = (await overlay.getByTestId('volume').boundingBox())!
  await overlay.mouse.move(slider.x + slider.width / 2, slider.y + slider.height / 2)
  await overlay.mouse.down()
  const { x, y } = await centre(overlay)
  await overlay.mouse.move(x, y, { steps: 5 })
  await overlay.mouse.up()
  await overlay.waitForTimeout(300)
  await playLabel(overlay).toHaveAttribute('aria-label', 'Pause')
})

test('Click does nothing while the next-episode card shows', async () => {
  await start()
  const videoId = await episodeId('Breaking Bad', 1, 1)
  const overlay = await playTitle('Breaking Bad', { videoId, from: 'start' })
  await win.evaluate(() => window.api.player.command({ type: 'seek', toS: 18.5 }))
  const nextPlay = overlay.getByTestId('next-play')
  await expect(nextPlay).toBeVisible({ timeout: 10_000 })
  const label = await overlay.getByTestId('play-pause').getAttribute('aria-label')
  const { x, y } = await centre(overlay)
  await overlay.mouse.click(x, y)
  await overlay.waitForTimeout(300)
  await expect(nextPlay).toBeVisible()
  await playLabel(overlay).toHaveAttribute('aria-label', label!)
})

test('Space pauses and resumes; arrows seek; ✕ closes to the title page', async () => {
  await start()
  const overlay = await playTitle('The Matrix', { from: 'start' })
  await overlay.keyboard.press(' ')
  await expect(overlay.getByTestId('play-pause')).toHaveAttribute('aria-label', 'Play')
  const paused = await position(overlay)
  await overlay.waitForTimeout(800)
  expect(Math.abs((await position(overlay)) - paused)).toBeLessThan(0.1)
  await overlay.keyboard.press(' ')
  await expect.poll(() => position(overlay)).toBeGreaterThan(paused + 0.3)

  const before = await position(overlay)
  await overlay.keyboard.press('ArrowRight')
  await expect.poll(() => position(overlay)).toBeGreaterThan(before + 8)
  await overlay.keyboard.press('ArrowLeft')
  await expect.poll(() => position(overlay)).toBeLessThan(before + 5)

  await closePlayer(overlay)
  await expect(win.getByTestId('title-page')).toBeVisible()
  await expect(win.getByTestId('title-heading')).toHaveText('The Matrix')
})

test('volume goes past 100 % and is remembered for that title only', async () => {
  await start()
  let overlay = await playTitle('The Matrix')
  for (let i = 0; i < 10; i++) await overlay.keyboard.press('ArrowUp')
  await expect(overlay.getByTestId('volume-value')).toHaveText('150%')
  await expect(overlay.getByTestId('volume')).toHaveAttribute('data-boost', 'true')
  for (let i = 0; i < 30; i++) await overlay.keyboard.press('ArrowUp')
  await expect(overlay.getByTestId('volume-value')).toHaveText('200%')
  for (let i = 0; i < 10; i++) await overlay.keyboard.press('ArrowDown')
  await expect(overlay.getByTestId('volume-value')).toHaveText('150%')
  await closePlayer(overlay)

  overlay = await playTitle('The Matrix')
  await expect(overlay.getByTestId('volume-value')).toHaveText('150%')
  await closePlayer(overlay)
  overlay = await playTitle('Amélie')
  await expect(overlay.getByTestId('volume-value')).toHaveText('100%')
})

test('Audio and Subtitles menus list the tracks and remember the choice', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vp-e2e-tracks-'))
  cleanup.push(dir)
  copyFileSync(resolve('tests', 'fixtures', 'media', 'tracks.mkv'), join(dir, 'Track Test (2020).mkv'))
  await start(dir)
  let overlay = await playTitle('Track Test')

  await overlay.getByTestId('audio-button').click()
  const menu = overlay.getByTestId('track-menu')
  await expect(menu.getByRole('menuitemradio')).toHaveText(['English 5.1', 'Japanese'])
  await menu.getByRole('menuitemradio', { name: 'Japanese' }).click()
  await expect(menu).toHaveCount(0)

  await overlay.getByTestId('subtitles-button').click()
  await expect(overlay.getByTestId('track-menu').getByRole('menuitemradio')).toHaveText([
    'Off',
    'English',
    'English (SDH)',
    'English (Forced)'
  ])
  // Esc with a menu open closes only the menu.
  await overlay.keyboard.press('Escape')
  await expect(overlay.getByTestId('track-menu')).toHaveCount(0)
  expect(await overlayVisible(app)).toBe(true)

  await closePlayer(overlay)
  overlay = await playTitle('Track Test')
  await overlay.getByTestId('audio-button').click()
  await expect(overlay.getByTestId('track-menu').getByRole('menuitemradio', { name: 'Japanese' })).toHaveAttribute('aria-checked', 'true')
})

test('controls fade while playing and come back on mouse move', async () => {
  await start()
  const overlay = await playTitle('The Matrix', { from: 'start' })
  const bar = overlay.getByTestId('controls')
  await expect(bar).toHaveAttribute('data-hidden', 'true', { timeout: 5000 })
  await overlay.mouse.move(200, 200)
  await overlay.mouse.move(220, 210)
  await expect(bar).toHaveAttribute('data-hidden', 'false')
})

test('an episode ending offers the next one: Play now, the countdown, and Cancel', async () => {
  await start()
  const s1e1 = await episodeId('Breaking Bad', 1, 1)
  const seekNearEnd = () => win.evaluate(() => window.api.player.command({ type: 'seek', toS: 18.5 }))

  let overlay = await playTitle('Breaking Bad', { videoId: s1e1, from: 'start' })
  await seekNearEnd()
  const card = overlay.getByTestId('next-card')
  await expect(card).toContainText('S1 E2', { timeout: 10_000 })
  await overlay.getByTestId('next-play').click()
  await expect(overlay.getByTestId('player-heading')).toContainText('S1 E2')
  await expect(card).toHaveCount(0)

  // Let the countdown run out.
  overlay = await playTitle('Breaking Bad', { videoId: s1e1, from: 'start' })
  await seekNearEnd()
  await expect(overlay.getByTestId('next-count')).toHaveText(/^\d+$/, { timeout: 10_000 })
  await expect(overlay.getByTestId('player-heading')).toContainText('S1 E2', { timeout: 15_000 })

  // Cancel keeps the player open on the last frame.
  overlay = await playTitle('Breaking Bad', { videoId: s1e1, from: 'start' })
  await seekNearEnd()
  await overlay.getByTestId('next-cancel').click({ timeout: 10_000 })
  await expect(overlay.getByTestId('next-card')).toHaveCount(0)
  await overlay.waitForTimeout(500)
  expect(await overlayVisible(app)).toBe(true)
  await closePlayer(overlay)
})

test('the last episode ending closes to the show page', async () => {
  await start()
  const last = await episodeId('Breaking Bad', 2, 1)
  await playTitle('Breaking Bad', { videoId: last, from: 'start' })
  await win.evaluate(() => window.api.player.command({ type: 'seek', toS: 18.5 }))
  await expect.poll(() => overlayVisible(app), { timeout: 10_000 }).toBe(false)
  await expect(win.getByTestId('title-heading')).toHaveText('Breaking Bad')
})

test("Can't play this file stays up when other updates arrive", async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vp-e2e-broken-'))
  cleanup.push(dir)
  copyFileSync(resolve('tests', 'fixtures', 'media', 'truncated.mp4'), join(dir, 'Broken Film (2001).mp4'))
  await start(dir)
  const key = await keyOf(win, 'Broken Film')
  await win.evaluate((k) => window.api.player.play({ key: k }), key)
  const overlay = await overlayPage(app)
  await expect(overlay.getByTestId('player-error')).toHaveText("Can't play this file")
  await overlay.keyboard.press('ArrowUp')
  await overlay.keyboard.press('m')
  await overlay.waitForTimeout(500)
  await expect(overlay.getByTestId('player-error')).toHaveText("Can't play this file")
})

test('after using the volume slider, the player keys still work', async () => {
  await start()
  const overlay = await playTitle('The Matrix', { from: 'start' })
  await overlay.mouse.move(300, 300)
  await overlay.getByTestId('volume').click()
  await overlay.keyboard.press(' ')
  await expect(overlay.getByTestId('play-pause')).toHaveAttribute('aria-label', 'Play')
  const before = await position(overlay)
  await overlay.keyboard.press('ArrowRight')
  await expect.poll(() => position(overlay)).toBeGreaterThan(before + 8)
})

/// <reference lib="dom" />
/// <reference path="../../src/preload/index.d.ts" />
import { resolve } from 'node:path'
import { rmSync } from 'node:fs'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { closeApp, focusTile, keyOf, launchApp, openTile, overlayPage, overlayVisible, position, wallTitles } from './pages'

const LIBRARY = resolve('tests', 'fixtures', 'library')
const ALL_TITLES = ['Amélie', 'Breaking Bad', 'Inception', 'Some Unknown Home Video', 'The Matrix']
let userData: string
let app: ElectronApplication
let win: Page

test.beforeEach(async () => {
  ;({ app, win, userData } = await launchApp(LIBRARY))
  await expect.poll(() => wallTitles(win), { timeout: 30_000 }).toEqual(expect.arrayContaining(ALL_TITLES))
})

test.afterEach(async () => {
  await closeApp(app)
  rmSync(userData, { recursive: true, force: true })
})

const detail = async (title: string) => {
  const key = await keyOf(win, title)
  return (await win.evaluate((k) => window.api.library.getTitle({ key: k }), key))!
}

test('Enter on a movie opens its page with the full synopsis and rating; Esc goes back', async () => {
  const d = await detail('The Matrix')
  await openTile(win, 'The Matrix')
  await expect(win.getByTestId('title-heading')).toHaveText('The Matrix')
  await expect(win.getByTestId('title-synopsis')).toHaveText(d.overview!)
  await expect(win.getByTestId('title-rating')).toHaveText(`TMDB ${d.rating!.toFixed(1)}`)
  await expect(win.getByTestId('title-main')).toBeFocused()
  await win.keyboard.press('Escape')
  await expect(win.getByTestId('title-page')).toHaveCount(0)
  await expect(win.getByTestId('wall-home')).toBeVisible()
  await expect(win.getByTestId('wall-live')).toHaveText(/^The Matrix/)
})

test('an unmatched title shows no synopsis and no rating', async () => {
  await openTile(win, 'Some Unknown Home Video')
  await expect(win.getByTestId('title-heading')).toHaveText('Some Unknown Home Video')
  await expect(win.getByTestId('title-synopsis')).toHaveCount(0)
  await expect(win.getByTestId('title-rating')).toHaveCount(0)
})

test('Play, close, then Continue watching and Restart', async () => {
  await openTile(win, 'The Matrix')
  await expect(win.getByTestId('title-main')).toHaveText(/Play$/)
  await expect(win.getByTestId('title-restart')).toHaveCount(0)
  await win.getByTestId('title-main').click()
  let overlay = await overlayPage(app)
  await expect.poll(() => position(overlay), { timeout: 8000 }).toBeGreaterThan(3)
  await overlay.mouse.move(40, 40) // wakes the faded controls, as a real pointer does
  await overlay.getByTestId('player-close').click()
  await expect.poll(() => overlayVisible(app)).toBe(false)

  await expect(win.getByTestId('title-page')).toBeVisible()
  await expect(win.getByTestId('title-main')).toHaveText(/Continue watching$/)
  await expect(win.getByTestId('title-restart')).toHaveText(/Restart$/)
  await expect(win.getByTestId('title-left')).toHaveText(/left$/)

  await win.getByTestId('title-restart').click()
  overlay = await overlayPage(app)
  await expect.poll(overlayVisible.bind(null, app)).toBe(true)
  await expect.poll(() => position(overlay)).toBeLessThan(2)
})

test('a show page lists seasons and plays the chosen episode', async () => {
  await openTile(win, 'Breaking Bad')
  await expect(win.getByTestId('title-main')).toHaveText(/Play S1 E1$/)
  await expect(win.getByTestId('season-tab')).toHaveText(['Season 1', 'Season 2'])
  await expect(win.getByTestId('episode-card')).toHaveCount(2)
  await win.getByTestId('episode-card').nth(1).click()
  const overlay = await overlayPage(app)
  await expect(overlay.getByTestId('player-heading')).toContainText('S1 E2')
})

test("the info card's button plays straight from the wall", async () => {
  await focusTile(win, 'The Matrix')
  const card = win.getByTestId('info-card')
  await expect(card).toContainText('The Matrix')
  await card.getByRole('button', { name: 'Play' }).click()
  const overlay = await overlayPage(app)
  await expect(overlay.getByTestId('player-heading')).toHaveText('The Matrix')
  await expect(win.getByTestId('title-page')).toHaveCount(0)
})

test('back from the player, focus is on the main button and the season follows what played', async () => {
  await openTile(win, 'Breaking Bad')
  await expect(win.getByTestId('title-main')).toBeFocused()
  await win.keyboard.press('Enter') // Play S1 E1 from the focused main button
  let overlay = await overlayPage(app)
  await expect.poll(() => position(overlay), { timeout: 8000 }).toBeGreaterThan(1)
  await overlay.keyboard.press('Escape')
  await expect.poll(() => overlayVisible(app)).toBe(false)
  await expect(win.getByTestId('title-main')).toBeFocused()

  // Play S1 E2, then let it move on to S2 E1 and close there.
  await win.getByTestId('episode-card').nth(1).click()
  overlay = await overlayPage(app)
  await expect(overlay.getByTestId('player-heading')).toContainText('S1 E2')
  // Seek only once the file is playing: a seek sent while mpv is still opening it is dropped.
  await expect.poll(() => position(overlay), { timeout: 8000 }).toBeGreaterThan(0.5)
  await win.evaluate(() => window.api.player.command({ type: 'seek', toS: 18.5 }))
  await overlay.getByTestId('next-play').click({ timeout: 10_000 })
  await expect(overlay.getByTestId('player-heading')).toContainText('S2 E1')
  await expect.poll(() => position(overlay), { timeout: 8000 }).toBeGreaterThan(1)
  await overlay.keyboard.press('Escape')
  await expect.poll(() => overlayVisible(app)).toBe(false)
  await expect(win.getByTestId('season-tab').filter({ hasText: 'Season 2' })).toHaveAttribute('aria-pressed', 'true')
})

test('holding Enter on the wall opens the page but does not start playback', async () => {
  await focusTile(win, 'The Matrix')
  await win.keyboard.down('Enter')
  await expect(win.getByTestId('title-main')).toBeFocused()
  for (let i = 0; i < 5; i++) await win.keyboard.down('Enter') // auto-repeat
  await win.keyboard.up('Enter')
  await win.waitForTimeout(800)
  expect(await overlayVisible(app)).toBe(false)
})

test("resting the mouse on the info card's button keeps that title and plays it", async () => {
  await focusTile(win, 'The Matrix')
  const card = win.getByTestId('info-card')
  await expect(card).toContainText('The Matrix')
  const button = card.getByRole('button', { name: 'Play' })
  const box = (await button.boundingBox())!
  // Approach the button slowly, the way a hand does, and rest on it.
  await win.mouse.move(box.x + box.width / 2 + 120, box.y - 80)
  await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 12 })
  await win.waitForTimeout(700)
  await expect(card).toContainText('The Matrix')
  await button.click()
  const overlay = await overlayPage(app)
  await expect(overlay.getByTestId('player-heading')).toHaveText('The Matrix')
})

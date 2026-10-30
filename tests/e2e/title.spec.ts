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

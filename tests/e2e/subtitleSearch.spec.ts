/// <reference lib="dom" />
/// <reference path="../../src/preload/index.d.ts" />
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { closeApp, keyOf, launchApp, overlayPage } from './pages'

const MATRIX = 'The.Matrix.1999.1080p.BluRay.x264'
let dir: string
let userData: string
let app: ElectronApplication
let win: Page

// A library of its own, so downloads never land in the shared fixture library.
test.beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'vp-e2e-search-'))
  for (const ext of ['mkv', 'en.srt']) copyFileSync(resolve('tests', 'fixtures', 'library', `${MATRIX}.${ext}`), join(dir, `${MATRIX}.${ext}`))
  ;({ app, win, userData } = await launchApp(dir))
})

test.afterEach(async () => {
  await closeApp(app)
  rmSync(userData, { recursive: true, force: true })
  rmSync(dir, { recursive: true, force: true })
})

async function openSearch(): Promise<Page> {
  const key = await keyOf(win, 'The Matrix')
  await win.evaluate((k) => window.api.player.play({ key: k, from: 'start' }), key)
  const overlay = await overlayPage(app)
  await expect(overlay.getByTestId('player-heading')).toHaveText('The Matrix')
  await overlay.mouse.move(300, 300)
  await overlay.getByTestId('subtitles-button').click()
  await overlay.getByRole('menuitem', { name: 'Search online…' }).click()
  await expect(overlay.getByTestId('search-panel')).toBeVisible()
  return overlay
}

test('without an account, searching online says to add one', async () => {
  const overlay = await openSearch()
  await expect(overlay.getByTestId('search-panel')).toContainText('Add your OpenSubtitles account in Settings')
})

test('a downloaded subtitle shows at once and is saved next to the film without touching the old one', async () => {
  const original = readFileSync(join(dir, `${MATRIX}.en.srt`))
  await win.evaluate(() => window.api.subtitles.setAccount({ apiKey: 'k', username: 'u', password: 'p' }))
  const overlay = await openSearch()
  const rows = overlay.getByTestId('search-result')
  await expect(rows).toHaveCount(3)
  await expect(rows.first()).toContainText('Matches your file')
  await rows.first().click()
  await expect(overlay.getByTestId('search-panel')).toHaveCount(0)
  await overlay.evaluate(() => window.api.player.command({ type: 'pause', paused: true }))
  await overlay.evaluate(() => window.api.player.command({ type: 'seek', toS: 2 }))
  await expect(overlay.locator('[data-testid="subtitle"][data-shown="true"]')).toHaveText('There is no spoon.', { timeout: 3000 })
  expect(existsSync(join(dir, `${MATRIX}.en.2.srt`))).toBe(true)
  expect(readFileSync(join(dir, `${MATRIX}.en.srt`)).equals(original)).toBe(true)
})

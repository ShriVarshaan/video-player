/// <reference lib="dom" />
/// <reference path="../../src/preload/index.d.ts" />
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import type { PlayerCommand } from '@shared/player'
import { closeApp, keyOf, launchApp, overlayPage } from './pages'

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

async function play(title: string, videoId?: number): Promise<Page> {
  const key = await keyOf(win, title)
  await win.evaluate(([k, v]) => window.api.player.play({ key: k as string, videoId: v as number | undefined, from: 'start' }), [key, videoId])
  const overlay = await overlayPage(app)
  await expect(overlay.getByTestId('player-heading')).toContainText(title)
  return overlay
}
const send = (overlay: Page, c: PlayerCommand) => overlay.evaluate((c) => window.api.player.command(c), c)
// Pauses at a time inside a cue, so the line is checked without racing the clock.
async function holdAt(overlay: Page, s: number) {
  await send(overlay, { type: 'pause', paused: true })
  await send(overlay, { type: 'seek', toS: s })
}
const line = (overlay: Page) => overlay.locator('[data-testid="subtitle"][data-shown="true"]')

test('a subtitle file next to the movie comes on by itself and follows the film', async () => {
  ;({ app, win, userData } = await launchApp(LIBRARY))
  const overlay = await play('The Matrix')
  await expect(line(overlay)).toHaveText('Wake up, Neo.', { timeout: 8000 })
  await expect(line(overlay)).toHaveCount(0, { timeout: 5000 })
  // Faded controls take no clicks; moving the mouse brings them back.
  await overlay.mouse.move(200, 200)
  await overlay.getByTestId('subtitles-button').click()
  await expect(overlay.getByRole('menuitemradio', { name: 'English' })).toHaveAttribute('aria-checked', 'true')
})

test('a paused seek into a line shows it at once', async () => {
  ;({ app, win, userData } = await launchApp(LIBRARY))
  const overlay = await play('The Matrix')
  await expect(line(overlay)).toHaveText('Wake up, Neo.', { timeout: 8000 })
  await holdAt(overlay, 6)
  await expect(line(overlay)).toHaveText('Follow the white rabbit.', { timeout: 1500 })
})

test('a Windows-1252 French file keeps its accents', async () => {
  ;({ app, win, userData } = await launchApp(LIBRARY))
  const overlay = await play('Amélie')
  await overlay.getByTestId('subtitles-button').click()
  await overlay.getByRole('menuitemradio', { name: 'French' }).click()
  await holdAt(overlay, 2)
  await expect(line(overlay)).toHaveText("Le fabuleux destin d'Amélie", { timeout: 3000 })
})

test('an episode finds its subtitle in a Subs folder', async () => {
  ;({ app, win, userData } = await launchApp(LIBRARY))
  const key = await keyOf(win, 'Breaking Bad')
  const title = await win.evaluate((k) => window.api.library.getTitle({ key: k }), key)
  const pilot = title!.seasons.flatMap((s) => s.episodes).find((e) => e.season === 1 && e.episode === 1)!
  const overlay = await play('Breaking Bad', pilot.videoId)
  await holdAt(overlay, 2)
  await expect(line(overlay)).toHaveText('Say my name.', { timeout: 3000 })
})

test('an embedded text subtitle is drawn by the app, not mpv', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vp-e2e-subs-'))
  cleanup.push(dir)
  copyFileSync(resolve('tests', 'fixtures', 'media', 'tracks.mkv'), join(dir, 'Track Test (2020).mkv'))
  ;({ app, win, userData } = await launchApp(dir))
  const overlay = await play('Track Test')
  await overlay.getByTestId('subtitles-button').click()
  await overlay.getByRole('menuitemradio', { name: 'English', exact: true }).click()
  await holdAt(overlay, 2)
  await expect(line(overlay)).toHaveText('Hello there.', { timeout: 3000 })
})

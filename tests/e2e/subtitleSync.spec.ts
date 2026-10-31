/// <reference lib="dom" />
/// <reference path="../../src/preload/index.d.ts" />
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import type { PlayerCommand } from '@shared/player'
import { REACTION_LEAD_S } from '@shared/subtitleTiming'
import { closeApp, keyOf, launchApp, overlayPage, position } from './pages'

// Matrix cues: "Wake up, Neo." 1–4 s, "Follow the white rabbit." 5–8 s.
const MATRIX = 'The.Matrix.1999.1080p.BluRay.x264'
const FIXTURES = resolve('tests', 'fixtures', 'library')
let dir: string
let userData: string
let app: ElectronApplication
let win: Page

test.beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vp-e2e-sync-'))
  for (const name of [`${MATRIX}.mkv`, `${MATRIX}.en.srt`, 'Amélie (2001).mp4', 'Amélie (2001).fr.srt']) copyFileSync(join(FIXTURES, name), join(dir, name))
})

test.afterEach(async () => {
  await closeApp(app)
  rmSync(userData, { recursive: true, force: true })
  rmSync(dir, { recursive: true, force: true })
})

async function play(title: string): Promise<Page> {
  const key = await keyOf(win, title)
  await win.evaluate((k) => window.api.player.play({ key: k, from: 'start' }), key)
  const overlay = await overlayPage(app)
  await expect(overlay.getByTestId('player-heading')).toContainText(title)
  return overlay
}
const send = (overlay: Page, c: PlayerCommand) => overlay.evaluate((c) => window.api.player.command(c), c)
// Pauses at s and waits until the overlay shows that position.
async function holdAt(overlay: Page, s: number) {
  await send(overlay, { type: 'pause', paused: true })
  // A seek sent before mpv has opened the file is dropped: wait for it to be playing first.
  await expect.poll(() => overlay.getByTestId('player-time').evaluate((el) => el.textContent ?? '')).not.toBe('')
  await expect
    .poll(async () => {
      await send(overlay, { type: 'seek', toS: s })
      return Math.abs((await position(overlay)) - s) < 0.1
    })
    .toBe(true)
}
const line = (overlay: Page) => overlay.locator('[data-testid="subtitle"][data-shown="true"]')
const note = (overlay: Page) => overlay.getByTestId('timing-note')
async function menuAction(overlay: Page, name: string) {
  await overlay.mouse.move(200, 200)
  await overlay.getByTestId('subtitles-button').click()
  await overlay.getByRole('menuitem', { name }).click()
}

test('Shift+H four times moves the subtitles 2 s later, and it is remembered', async () => {
  ;({ app, win, userData } = await launchApp(dir))
  let overlay = await play('The Matrix')
  await expect(line(overlay)).toHaveText('Wake up, Neo.', { timeout: 8000 })
  for (let i = 0; i < 4; i++) await overlay.keyboard.press('Shift+H')
  await expect(note(overlay)).toHaveText('Subtitles +2.00 s')
  await holdAt(overlay, 2.5)
  await expect(line(overlay)).toHaveCount(0)
  await holdAt(overlay, 3.5)
  await expect(line(overlay)).toHaveText('Wake up, Neo.')

  await overlay.evaluate(() => window.api.player.stop({}))
  overlay = await play('The Matrix')
  await holdAt(overlay, 2.5)
  await expect(line(overlay)).toHaveCount(0)
  await holdAt(overlay, 3.5)
  await expect(line(overlay)).toHaveText('Wake up, Neo.', { timeout: 3000 })
})

test('a fix stays with its film', async () => {
  ;({ app, win, userData } = await launchApp(dir))
  let overlay = await play('The Matrix')
  await expect(line(overlay)).toHaveText('Wake up, Neo.', { timeout: 8000 })
  for (let i = 0; i < 4; i++) await overlay.keyboard.press('Shift+H')
  await expect(note(overlay)).toHaveText('Subtitles +2.00 s')
  await overlay.evaluate(() => window.api.player.stop({}))
  overlay = await play('Amélie')
  await overlay.mouse.move(200, 200)
  await overlay.getByTestId('subtitles-button').click()
  await overlay.getByRole('menuitemradio', { name: /French/ }).click()
  await holdAt(overlay, 1.5)
  await expect(line(overlay)).toHaveText("Le fabuleux destin d'Amélie", { timeout: 3000 })
})

test('sync to a line: press S when the shown line is heard', async () => {
  ;({ app, win, userData } = await launchApp(dir))
  const overlay = await play('The Matrix')
  await holdAt(overlay, 0.5)
  await overlay.keyboard.press('s')
  const card = overlay.getByTestId('sync-card')
  await expect(card.getByTestId('sync-line')).toHaveText('Wake up, Neo.')
  await expect(card).toContainText('Press S when you hear')
  await overlay.keyboard.press('ArrowRight')
  await expect(card.getByTestId('sync-line')).toHaveText('Follow the white rabbit.')
  // The player's own keys don't act while the card is open.
  await overlay.keyboard.press(' ')
  await overlay.waitForTimeout(400)
  await expect(overlay.getByTestId('play-pause')).toHaveAttribute('aria-label', 'Play')
  await holdAt(overlay, 9)
  await overlay.keyboard.press('s')
  await expect(card).toHaveCount(0)
  await expect(note(overlay)).toHaveText(`Subtitles +${(4 - REACTION_LEAD_S).toFixed(2)} s`)
})

test('Esc on the sync card changes nothing', async () => {
  ;({ app, win, userData } = await launchApp(dir))
  const overlay = await play('The Matrix')
  await holdAt(overlay, 0.5)
  await overlay.keyboard.press('s')
  await expect(overlay.getByTestId('sync-line')).toHaveText('Wake up, Neo.')
  await overlay.keyboard.press('Escape')
  await expect(overlay.getByTestId('sync-card')).toHaveCount(0)
  await expect(overlay.getByTestId('player-heading')).toContainText('The Matrix') // Esc closed the card, not the player
  await expect(note(overlay)).toHaveCount(0)
  await holdAt(overlay, 1.5)
  await expect(line(overlay)).toHaveText('Wake up, Neo.', { timeout: 3000 })
})

test('the offset slider moves the subtitles live', async () => {
  ;({ app, win, userData } = await launchApp(dir))
  const overlay = await play('The Matrix')
  await expect(line(overlay)).toHaveText('Wake up, Neo.', { timeout: 8000 })
  await menuAction(overlay, 'Set offset…')
  const panel = overlay.getByTestId('offset-panel')
  const slider = panel.getByRole('slider', { name: 'Subtitle offset' })
  await expect(slider).toBeFocused()
  for (let i = 0; i < 4; i++) await overlay.keyboard.press('Shift+ArrowRight')
  await expect(panel.getByTestId('offset-value')).toHaveText('+2.00 s')
  await overlay.keyboard.press('ArrowLeft')
  await expect(panel.getByTestId('offset-value')).toHaveText('+1.95 s')
  await overlay.keyboard.press('ArrowRight')
  await overlay.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)
  await expect(overlay.getByTestId('player-heading')).toContainText('The Matrix') // Esc closed the panel only
  await holdAt(overlay, 2.5)
  await expect(line(overlay)).toHaveCount(0)
  await holdAt(overlay, 3.5)
  await expect(line(overlay)).toHaveText('Wake up, Neo.', { timeout: 3000 })

  await menuAction(overlay, 'Set offset…')
  await expect(overlay.getByTestId('offset-value')).toHaveText('+2.00 s')
  await overlay.keyboard.press('Home')
  await expect(overlay.getByTestId('offset-value')).toHaveText('in sync')
  await overlay.getByRole('button', { name: 'Done' }).click()
  await expect(overlay.getByTestId('offset-panel')).toHaveCount(0)
  await holdAt(overlay, 1.5)
  await expect(line(overlay)).toHaveText('Wake up, Neo.', { timeout: 3000 })
})

test('changing the subtitle track closes the sync card (review)', async () => {
  ;({ app, win, userData } = await launchApp(dir))
  const overlay = await play('The Matrix')
  await holdAt(overlay, 0.5)
  await overlay.keyboard.press('s')
  await expect(overlay.getByTestId('sync-line')).toHaveText('Wake up, Neo.')
  await send(overlay, { type: 'subtitle', id: null })
  await expect(overlay.getByTestId('sync-card')).toHaveCount(0)
})

test('export writes a synced file next to the film and shows it', async () => {
  const original = readFileSync(join(dir, `${MATRIX}.en.srt`))
  const synced = join(dir, `${MATRIX}.en.synced.srt`)
  ;({ app, win, userData } = await launchApp(dir))
  const overlay = await play('The Matrix')
  await expect(line(overlay)).toHaveText('Wake up, Neo.', { timeout: 8000 })
  await overlay.keyboard.press('Shift+H')
  await overlay.keyboard.press('Shift+H')
  await expect(note(overlay)).toHaveText('Subtitles +1.00 s')
  await menuAction(overlay, 'Export synced .srt')
  await expect(note(overlay)).toHaveText(`Saved ${MATRIX}.en.synced.srt`)
  expect(readFileSync(synced, 'utf8')).toContain('00:00:02,000 --> 00:00:05,000')
  expect(readFileSync(join(dir, `${MATRIX}.en.srt`)).equals(original)).toBe(true)

  await overlay.getByTestId('subtitles-button').click()
  await expect(overlay.getByRole('menuitemradio', { checked: true })).toContainText('English · Synced')
  await overlay.keyboard.press('Escape')

  // Exporting again asks first; Cancel leaves the file as it is.
  const before = readFileSync(synced)
  await menuAction(overlay, 'Export synced .srt')
  const confirm = overlay.getByTestId('confirm-replace')
  await expect(confirm).toContainText('Replace the existing synced subtitles?')
  await confirm.getByRole('button', { name: 'Cancel' }).click()
  await expect(confirm).toHaveCount(0)
  expect(readFileSync(synced).equals(before)).toBe(true)
  expect(existsSync(synced)).toBe(true)
})

test('embedded subtitle: the sync card reads it from the video', async () => {
  copyFileSync(resolve('tests', 'fixtures', 'media', 'tracks.mkv'), join(dir, 'Track Test (2020).mkv'))
  ;({ app, win, userData } = await launchApp(dir))
  const overlay = await play('Track Test')
  await overlay.mouse.move(200, 200)
  await overlay.getByTestId('subtitles-button').click()
  await overlay.getByRole('menuitemradio', { name: 'English', exact: true }).click()
  await holdAt(overlay, 0.5)
  await overlay.keyboard.press('s')
  await expect(overlay.getByTestId('sync-line')).toHaveText('Hello there.', { timeout: 15_000 })
})

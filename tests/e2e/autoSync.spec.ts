/// <reference lib="dom" />
/// <reference path="../../src/preload/index.d.ts" />
import { copyFileSync, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { closeApp, keyOf, launchApp, overlayPage, position } from './pages'

// speech.mkv: ~7.5 min of TTS lines; speech.shift+3.2.srt is the truth 3.2 s late.
const MEDIA = resolve('tests', 'fixtures', 'media')
const NAME = 'Speech Test (2020)'
const SYNCED = `${NAME}.en.synced.srt`
let dir: string
let userData: string
let app: ElectronApplication
let win: Page

test.skip(!existsSync(resolve('sidecar', '.venv', 'Scripts', 'python.exe')), 'run npm run setup-sidecar for the auto sync helper')
test.skip(!existsSync(join(MEDIA, 'speech-long.mkv')), 'run node scripts/make-fixtures.mjs for the speech clips')

// video: speech-long.mkv (~90 min) when the test needs the sync to take a few seconds.
function library(subtitle: string, video = 'speech.mkv') {
  dir = mkdtempSync(join(tmpdir(), 'vp-e2e-autosync-'))
  copyFileSync(join(MEDIA, video), join(dir, `${NAME}.mkv`))
  copyFileSync(join(MEDIA, subtitle), join(dir, `${NAME}.en.srt`))
}

test.afterEach(async () => {
  await closeApp(app)
  rmSync(userData, { recursive: true, force: true })
  rmSync(dir, { recursive: true, force: true })
})

async function play(): Promise<Page> {
  const key = await keyOf(win, 'Speech Test')
  await win.evaluate((k) => window.api.player.play({ key: k, from: 'start' }), key)
  const overlay = await overlayPage(app)
  await expect(overlay.getByTestId('player-heading')).toContainText('Speech Test')
  // The file must be open (audio track known) before syncing.
  await expect.poll(() => position(overlay), { timeout: 10_000 }).toBeGreaterThan(0.3)
  // A must not come before the subtitle is picked.
  await openSubtitles(overlay)
  await expect(checked(overlay)).toContainText('English')
  await overlay.keyboard.press('Escape')
  await expect(overlay.getByRole('menuitemradio')).toHaveCount(0)
  return overlay
}
const note = (overlay: Page) => overlay.getByTestId('timing-note')
const card = (overlay: Page) => overlay.getByTestId('auto-sync-card')
const checked = (overlay: Page) => overlay.getByRole('menuitemradio', { checked: true })
async function openSubtitles(overlay: Page) {
  await overlay.mouse.move(200, 200)
  await overlay.getByTestId('subtitles-button').click()
}

test('A syncs the subtitle and selects the synced file', async () => {
  library('speech.shift+3.2.srt')
  ;({ app, win, userData } = await launchApp(dir))
  const overlay = await play()
  await overlay.keyboard.press('a')
  await expect(card(overlay)).toBeVisible()
  await expect(note(overlay)).toHaveText(/^Synced · 3\.2 s earlier/, { timeout: 30_000 })
  await expect(card(overlay)).toHaveCount(0)
  expect(existsSync(join(dir, SYNCED))).toBe(true)
  await openSubtitles(overlay)
  await expect(checked(overlay)).toContainText('English · Synced')
})

test('the menu item runs it too, and a second run asks before replacing', async () => {
  library('speech.shift+3.2.srt')
  ;({ app, win, userData } = await launchApp(dir))
  const overlay = await play()
  await openSubtitles(overlay)
  await overlay.getByRole('menuitem', { name: 'Auto sync' }).click()
  await expect(note(overlay)).toHaveText(/^Synced/, { timeout: 30_000 })
  const before = statSync(join(dir, SYNCED)).mtimeMs
  // Back on the original file: syncing it again lands on the same synced name.
  await openSubtitles(overlay)
  await overlay.getByRole('menuitemradio', { name: /^English(?!.*Synced)/ }).click()
  await overlay.keyboard.press('a')
  const confirm = overlay.getByTestId('confirm-replace')
  await expect(confirm).toBeVisible({ timeout: 30_000 })
  await expect(card(overlay)).toHaveCount(0)
  await confirm.getByRole('button', { name: 'Replace' }).click()
  await expect(note(overlay)).toHaveText(/^Synced · 3\.2 s earlier/)
  await expect.poll(() => statSync(join(dir, SYNCED)).mtimeMs).toBeGreaterThan(before)
})

test('a synced track nudged out of time is already in sync: the offset is cleared', async () => {
  library('speech.shift+3.2.srt')
  ;({ app, win, userData } = await launchApp(dir))
  const overlay = await play()
  await overlay.keyboard.press('a')
  await expect(note(overlay)).toHaveText(/^Synced/, { timeout: 30_000 })
  for (let i = 0; i < 4; i++) await overlay.keyboard.press('Shift+H')
  await expect(note(overlay)).toHaveText('Subtitles +2.00 s')
  await overlay.keyboard.press('a')
  await expect(note(overlay)).toHaveText('Already in sync · offset cleared', { timeout: 30_000 })
  await expect(overlay.getByTestId('confirm-replace')).toHaveCount(0)
})

test('a wrong subtitle leaves timing alone', async () => {
  library('speech.wrong.srt')
  ;({ app, win, userData } = await launchApp(dir))
  const overlay = await play()
  await overlay.keyboard.press('a')
  await expect(note(overlay)).toHaveText("Couldn't sync this subtitle confidently", { timeout: 30_000 })
  expect(existsSync(join(dir, SYNCED))).toBe(false)
  await openSubtitles(overlay)
  await expect(checked(overlay)).toContainText('English')
  await expect(checked(overlay)).not.toContainText('Synced')
})

test('Esc cancels the sync and the player stays open', async () => {
  library('speech.shift+3.2.srt', 'speech-long.mkv')
  ;({ app, win, userData } = await launchApp(dir))
  const overlay = await play()
  await overlay.keyboard.press('a')
  await expect(card(overlay)).toBeVisible()
  await overlay.keyboard.press('Escape')
  await expect(card(overlay)).toHaveCount(0)
  await expect(overlay.getByTestId('player-heading')).toContainText('Speech Test')
  await overlay.waitForTimeout(12_000) // longer than a whole sync of this clip
  expect(existsSync(join(dir, SYNCED))).toBe(false)
})

test('playback keys work while syncing', async () => {
  library('speech.shift+3.2.srt', 'speech-long.mkv')
  ;({ app, win, userData } = await launchApp(dir))
  const overlay = await play()
  await overlay.keyboard.press('a')
  await expect(card(overlay)).toBeVisible()
  await overlay.keyboard.press(' ')
  await expect(overlay.getByTestId('play-pause')).toHaveAttribute('aria-label', 'Play')
})

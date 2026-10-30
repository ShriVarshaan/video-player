/// <reference lib="dom" />
/// <reference path="../../src/preload/index.d.ts" />
import { rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { closeApp, goTo, keyOf, launchApp, overlayPage } from './pages'

const LIBRARY = resolve('tests', 'fixtures', 'library')
let userData: string
let app: ElectronApplication
let win: Page

test.beforeEach(async () => {
  ;({ app, win, userData } = await launchApp(LIBRARY))
})

test.afterEach(async () => {
  await closeApp(app)
  rmSync(userData, { recursive: true, force: true })
})

async function play(title: string): Promise<Page> {
  const key = await keyOf(win, title)
  await win.evaluate((k) => window.api.player.play({ key: k, from: 'start' }), key)
  const overlay = await overlayPage(app)
  await expect(overlay.getByTestId('player-heading')).toHaveText(title)
  return overlay
}

async function close(overlay: Page) {
  await overlay.evaluate(() => window.api.player.stop({}))
  await expect(win.getByTestId('title-page')).toBeVisible()
}

const sub = (overlay: Page) => overlay.getByTestId('subtitle')
const fontPx = (overlay: Page) => sub(overlay).evaluate((e) => parseFloat((e as HTMLElement).style.fontSize))
const fontFamily = (overlay: Page) => sub(overlay).evaluate((e) => (e as HTMLElement).style.fontFamily)

async function openStyle(overlay: Page) {
  await overlay.mouse.move(300, 300)
  await overlay.getByTestId('subtitles-button').click()
  await overlay.getByRole('menuitem', { name: 'Style…' }).click()
  await expect(overlay.getByTestId('style-panel')).toBeVisible()
}

// Steps a picker row with the keyboard: ←/→ change its value.
async function step(page: Page, name: string, times: number, key = 'ArrowRight') {
  const row = page.getByRole('slider', { name })
  await row.focus()
  for (let i = 0; i < times; i++) await row.press(key)
}

test('style changes in the player stay with that title unless used for all', async () => {
  let overlay = await play('The Matrix')
  const normal = await fontPx(overlay)
  await openStyle(overlay)
  await step(overlay, 'Size', 5)
  await expect(overlay.getByRole('slider', { name: 'Size' })).toHaveAttribute('aria-valuetext', '150%')
  await expect.poll(() => fontPx(overlay)).toBeCloseTo(normal * 1.5, 0)
  // Esc closes just the panel.
  await overlay.keyboard.press('Escape')
  await expect(overlay.getByTestId('style-panel')).toHaveCount(0)
  await close(overlay)

  overlay = await play('Inception')
  await expect.poll(() => fontPx(overlay)).toBeCloseTo(normal, 0)
  await close(overlay)

  overlay = await play('The Matrix')
  await expect.poll(() => fontPx(overlay)).toBeCloseTo(normal * 1.5, 0)
  await openStyle(overlay)
  await overlay.getByRole('button', { name: 'Use for all movies and shows' }).click()
  await expect(overlay.getByRole('button', { name: 'Reset to my global style' })).toHaveCount(0)
  await close(overlay)

  overlay = await play('Inception')
  await expect.poll(() => fontPx(overlay)).toBeCloseTo(normal * 1.5, 0)
})

test('a Settings change reaches a title except for what was changed for it, and reset clears that', async () => {
  let overlay = await play('The Matrix')
  const normal = await fontPx(overlay)
  await openStyle(overlay)
  await step(overlay, 'Size', 5)
  await expect.poll(() => fontPx(overlay)).toBeCloseTo(normal * 1.5, 0)
  await close(overlay)

  await goTo(win, 'Settings')
  await expect(win.getByTestId('subtitle-preview')).toBeVisible()
  await step(win, 'Font', 2)
  await expect(win.getByRole('slider', { name: 'Font' })).toHaveAttribute('aria-valuetext', 'Georgia')
  await goTo(win, 'Home')

  overlay = await play('The Matrix')
  await expect.poll(() => fontFamily(overlay)).toContain('Georgia')
  expect(await fontPx(overlay)).toBeCloseTo(normal * 1.5, 0)
  await openStyle(overlay)
  await overlay.getByRole('button', { name: 'Reset to my global style' }).click()
  await expect.poll(() => fontPx(overlay)).toBeCloseTo(normal, 0)
  await expect(overlay.getByRole('button', { name: 'Reset to my global style' })).toHaveCount(0)
  expect(await fontFamily(overlay)).toContain('Georgia')
})

test('the subtitle language in Settings is picked from the app-drawn list and saved', async () => {
  await goTo(win, 'Settings')
  const picker = win.getByRole('combobox', { name: 'Subtitle language' })
  await expect(picker).toHaveText('English')
  await picker.click()
  await win.getByRole('listbox', { name: 'Subtitle language' }).getByRole('option', { name: 'Spanish' }).click()
  await expect(picker).toHaveText('Spanish')
  await expect.poll(() => win.evaluate(() => window.api.subtitles.getSettings({}).then((s) => s.language))).toBe('spa')
})

test('the position slider moves subtitles up, and low ones sit above the controls', async () => {
  const overlay = await play('The Matrix')
  const h = await overlay.evaluate(() => innerHeight)
  await openStyle(overlay)
  // Controls are showing while the panel is open: a line at 0 clears the control bar.
  const seekTop = await overlay.locator('.player-bottom .seek').evaluate((e) => e.getBoundingClientRect().top)
  await expect.poll(async () => Number(await sub(overlay).getAttribute('data-position'))).toBeGreaterThanOrEqual(h - seekTop)
  // The seek bar is also a "Position" slider; this one is in the style panel.
  const position = overlay.getByTestId('style-panel').getByRole('slider', { name: 'Position' })
  await position.focus()
  await overlay.keyboard.press('End')
  await expect(position).toHaveAttribute('aria-valuenow', '100')
  await expect.poll(async () => Number(await sub(overlay).getAttribute('data-position'))).toBeGreaterThan(h * 0.7)
})

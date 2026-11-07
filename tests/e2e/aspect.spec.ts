/// <reference lib="dom" />
/// <reference path="../../src/preload/index.d.ts" />
import { rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { closeApp, keyOf, launchApp, overlayPage, overlayVisible, position } from './pages'

const LIBRARY = resolve('tests', 'fixtures', 'library')
let userData: string
let app: ElectronApplication
let win: Page

test.afterEach(async () => {
  await closeApp(app)
  rmSync(userData, { recursive: true, force: true })
})

async function playMatrix(): Promise<Page> {
  ;({ app, win, userData } = await launchApp(LIBRARY))
  const key = await keyOf(win, 'The Matrix')
  await win.evaluate((k) => window.api.player.play({ key: k, from: 'start' }), key)
  const overlay = await overlayPage(app)
  await expect.poll(() => overlayVisible(app)).toBe(true)
  await expect.poll(() => position(overlay), { timeout: 8000 }).toBeGreaterThan(0.5)
  return overlay
}

const label = (overlay: Page) => overlay.getByTestId('aspect-label')

test('C cycles through VLC’s ratios and back; Shift+C goes straight to the original', async () => {
  const overlay = await playMatrix()
  await expect(label(overlay)).toHaveText(/^Default \(.+\)$/)
  const original = await label(overlay).textContent()
  for (const ratio of ['16:9', '4:3', '1:1', '16:10', '2.21:1', '2.35:1', '2.39:1', '5:4']) {
    await overlay.keyboard.press('c')
    await expect(label(overlay)).toHaveText(ratio)
  }
  await overlay.keyboard.press('c')
  await expect(label(overlay)).toHaveText(original!)

  await overlay.keyboard.press('c')
  await overlay.keyboard.press('c')
  await expect(label(overlay)).toHaveText('4:3')
  await overlay.keyboard.press('Shift+C')
  await expect(label(overlay)).toHaveText(original!)
})

test('the label sits top right, stays up briefly after a press, then fades with the controls', async () => {
  const overlay = await playMatrix()
  await overlay.keyboard.press('c')
  await expect(label(overlay)).toHaveAttribute('data-shown', 'true')
  const box = (await label(overlay).boundingBox())!
  const width = await overlay.evaluate(() => innerWidth)
  expect(box.x + box.width).toBeGreaterThan(width - 40)
  expect(box.y).toBeLessThan(40)
  await expect(label(overlay)).toHaveAttribute('data-shown', 'false', { timeout: 8000 })
})

test('with the default style, the label is in the same font as the subtitles', async () => {
  const overlay = await playMatrix()
  await overlay.keyboard.press('c')
  const font = () => label(overlay).evaluate((el) => getComputedStyle(el).fontFamily)
  const sub = await overlay.getByTestId('subtitle').evaluate((el) => getComputedStyle(el).fontFamily)
  expect(await font()).toBe(sub)
  expect(await font()).toContain('Segoe UI Variable Display')
})

test('subtitles move onto the picture when a ratio makes it narrower or shorter', async () => {
  const overlay = await playMatrix()
  const sub = overlay.getByTestId('subtitle')
  const box = () => sub.evaluate((el) => {
    const s = getComputedStyle(el)
    return { left: parseFloat(s.left), font: parseFloat(s.fontSize), position: Number((el as HTMLElement).dataset['position']) }
  })
  const windowSize = await overlay.evaluate(() => ({ w: innerWidth, h: innerHeight }))
  // Every key brings the controls back, and they lift the line: measure only once they've faded.
  const controlsGone = () => expect(overlay.getByTestId('controls')).toHaveAttribute('data-hidden', 'true', { timeout: 8000 })
  await controlsGone()
  const before = await box()

  await overlay.keyboard.press('c') // 16:9
  await overlay.keyboard.press('c') // 4:3
  await expect(label(overlay)).toHaveText('4:3')
  // 4:3 at the window's height, centred, then 10 % of that width kept clear.
  const pictureW = Math.min(windowSize.w, (windowSize.h * 4) / 3)
  const expected = (windowSize.w - pictureW) / 2 + pictureW * 0.1
  await expect.poll(async () => Math.abs((await box()).left - expected)).toBeLessThan(3)

  for (let i = 0; i < 5; i++) await overlay.keyboard.press('c') // on to 2.39:1
  await expect(label(overlay)).toHaveText('2.39:1')
  await controlsGone()
  // The picture's bottom edge, then the 4 % margin inside it.
  const pictureH = Math.min(windowSize.h, windowSize.w / 2.39)
  const expectedBottom = (windowSize.h - pictureH) / 2 + pictureH * 0.04
  await expect.poll(async () => Math.abs((await box()).position - expectedBottom)).toBeLessThan(3)

  await overlay.keyboard.press('Shift+C')
  await controlsGone()
  await expect.poll(box).toEqual(before)
})

/// <reference lib="dom" />
/// <reference path="../../src/preload/index.d.ts" />
import { rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import {
  closeApp,
  closeWithX,
  isFullScreen,
  keyOf,
  launchApp,
  mainBounds,
  overlayAndVideoRects,
  overlayPage,
  overlayVisible,
  position
} from './pages'

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

const size = async () => {
  const b = await mainBounds(app)
  return `${b.width}x${b.height}`
}

async function enterPip(overlay: Page) {
  await overlay.mouse.move(300, 300)
  await overlay.getByTestId('pip-button').click()
  await expect.poll(size).toBe('480x270')
}

test('the PiP button sits left of Audio on the bar', async () => {
  const overlay = await playMatrix()
  await overlay.mouse.move(300, 300)
  const pip = (await overlay.getByTestId('pip-button').boundingBox())!
  const audio = (await overlay.getByTestId('audio-button').boundingBox())!
  expect(pip.x + pip.width).toBeLessThanOrEqual(audio.x)
  expect(Math.abs(pip.y + pip.height / 2 - (audio.y + audio.height / 2))).toBeLessThanOrEqual(4)
})

test('PiP floats the playing window in the corner and P brings it back', async () => {
  const overlay = await playMatrix()
  const before = await mainBounds(app)
  await enterPip(overlay)
  const b = await mainBounds(app)
  expect(b.onTop).toBe(true)
  expect(b.x + b.width).toBe(b.workArea.x + b.workArea.width - 24)
  expect(b.y + b.height).toBe(b.workArea.y + b.workArea.height - 24)
  await expect.poll(async () => {
    const r = await overlayAndVideoRects(app)
    return r.overlay === r.video
  }).toBe(true)
  const t = await position(overlay)
  await expect.poll(() => position(overlay), { timeout: 5000 }).toBeGreaterThan(t + 1)
  await overlay.keyboard.press('p')
  await expect.poll(size).toBe(`${before.width}x${before.height}`)
  const after = await mainBounds(app)
  expect({ x: after.x, y: after.y, onTop: after.onTop }).toEqual({ x: before.x, y: before.y, onTop: false })
})

test('full screen, then PiP, then a double-click returns to full screen', async () => {
  const overlay = await playMatrix()
  await overlay.keyboard.press('f')
  await expect.poll(() => isFullScreen(app)).toBe(true)
  await enterPip(overlay)
  expect(await isFullScreen(app)).toBe(false)
  // Left of the middle buttons: the bare picture.
  await overlay.mouse.dblclick(80, 135)
  await expect.poll(() => isFullScreen(app)).toBe(true)
})

test('dragging the picture moves the window, and the spot is remembered', async () => {
  const overlay = await playMatrix()
  await enterPip(overlay)
  const start = await mainBounds(app)
  await overlay.mouse.move(80, 135)
  await overlay.mouse.down()
  // The window follows the pointer, so the same spot in it is 10, 5 further each time.
  for (let i = 1; i <= 10; i++) await overlay.mouse.move(80 - 10, 135 - 5, { steps: 1 })
  await overlay.mouse.up()
  await expect.poll(async () => (await mainBounds(app)).x).toBeLessThan(start.x)
  const moved = await mainBounds(app)
  expect(moved.y).toBeLessThan(start.y)
  await expect(overlay.getByTestId('play-pause')).toHaveAttribute('aria-label', 'Pause')
  await overlay.keyboard.press('p')
  await expect.poll(size).not.toBe('480x270')
  await overlay.keyboard.press('p')
  await expect.poll(async () => {
    const b = await mainBounds(app)
    return `${b.x},${b.y} ${b.width}x${b.height}`
  }).toBe(`${moved.x},${moved.y} 480x270`)
})

test('the top-left corner resizes at 16:9', async () => {
  const overlay = await playMatrix()
  await enterPip(overlay)
  await overlay.mouse.move(240, 135)
  const corner = overlay.locator('[data-testid="pip-edge"][data-edge="nw"]')
  const box = (await corner.boundingBox())!
  await overlay.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await overlay.mouse.down()
  // One move: the window grows under the pointer, so further page moves would overshoot on screen.
  await overlay.mouse.move(box.x + box.width / 2 - 160, box.y + box.height / 2 - 90)
  await overlay.mouse.up()
  await expect.poll(size).toBe('640x360')
})

test('in PiP the subtitle sits above the shown controls, and the ratio label stays out of the way', async () => {
  const overlay = await playMatrix()
  await enterPip(overlay)
  const sub = overlay.locator('[data-testid="subtitle"][data-shown="true"]').first()
  await expect(sub).toBeVisible({ timeout: 8000 })
  // Paused, the controls stay up.
  await overlay.keyboard.press(' ')
  await expect(overlay.getByTestId('play-pause')).toHaveAttribute('aria-label', 'Play')
  await expect(overlay.getByTestId('controls')).toHaveAttribute('data-hidden', 'false')
  await expect(sub).toBeVisible()
  // Settled, not a passing frame: the line must stay clear of the bar.
  await overlay.waitForTimeout(500)
  const s = (await sub.boundingBox())!
  const seek = (await overlay.getByTestId('seek').boundingBox())!
  expect(s.y + s.height).toBeLessThanOrEqual(seek.y)
  await expect(overlay.getByTestId('aspect-label')).toHaveAttribute('data-shown', 'false')
})

test('✕ in PiP stops and shows the title page at full size', async () => {
  const overlay = await playMatrix()
  const before = await mainBounds(app)
  await enterPip(overlay)
  await closeWithX(overlay)
  await expect.poll(() => overlayVisible(app)).toBe(false)
  await expect.poll(size).toBe(`${before.width}x${before.height}`)
  expect((await mainBounds(app)).onTop).toBe(false)
})

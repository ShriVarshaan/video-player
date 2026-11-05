/// <reference lib="dom" />
/// <reference path="../../src/preload/index.d.ts" />
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { closeApp, closeWithX, focusTile, goTo, keyOf, launchApp, overlayPage, position } from './pages'

const LIBRARY = resolve('tests', 'fixtures', 'library')
let app: ElectronApplication
let win: Page
let userData: string
let closed: Promise<void>
let isClosed = false

test.beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'vp-e2e-'))
})

test.afterEach(async () => {
  if (!isClosed) await closeApp(app)
  rmSync(userData, { recursive: true, force: true })
})

async function launch(mode: string, folder: string | null = null) {
  ;({ app, win } = await launchApp(folder, userData, { VP_UPDATE_MODE: mode }))
  isClosed = false
  closed = new Promise((done) =>
    app.once('close', () => {
      isClosed = true
      done()
    })
  )
}
const card = () => win.getByTestId('update-card')
const check = (manual = false) => win.evaluate((m) => window.api.updates.check({ manual: m }), manual)
const phase = () => win.evaluate(async () => (await window.api.updates.state({})).phase)
const play = (key: string) => win.evaluate((k) => window.api.player.play({ key: k, from: 'start' }), key)

test('the card shows the version and notes on Home', async () => {
  await launch('available')
  await check()
  await expect(card()).toContainText('9.9.9')
  await expect(card()).toContainText('Fixture release notes')
  // Notes are text: the fixture's HTML tags never reach the page, as tags or as text.
  await expect(win.getByTestId('update-notes').locator('*')).toHaveCount(0)
  await expect(card()).not.toContainText('<h2>')
})

test('not during a film, and it waits until the player closes', async () => {
  await launch('available', LIBRARY)
  await play(await keyOf(win, 'The Matrix'))
  const overlay = await overlayPage(app)
  await expect.poll(() => position(overlay), { timeout: 8000 }).toBeGreaterThan(1)
  await check()
  await expect.poll(phase).toBe('available')
  await expect(card()).toHaveCount(0)
  await expect(overlay.getByText('9.9.9')).toHaveCount(0)
  await closeWithX(overlay)
  await expect(win.getByTestId('title-page')).toBeVisible()
  await expect(card()).toHaveCount(0)
  await goTo(win, 'Home')
  await expect(card()).toBeVisible()
})

test('not on a title page, search or Settings; back on Home it shows', async () => {
  await launch('available', LIBRARY)
  await check()
  await expect(card()).toBeVisible()
  await goTo(win, 'Settings')
  await expect(card()).toHaveCount(0)
  await goTo(win, 'Search')
  await expect(card()).toHaveCount(0)
  await goTo(win, 'Home')
  await expect(card()).toBeVisible()
  await focusTile(win, 'The Matrix')
  await win.keyboard.press('Enter')
  await expect(win.getByTestId('title-page')).toBeVisible()
  await expect(card()).toHaveCount(0)
  await goTo(win, 'Home')
  await expect(card()).toBeVisible()
})

test('Remind me later hides it and it returns on the next launch', async () => {
  await launch('available')
  await check()
  await win.getByTestId('update-later').click()
  await expect(card()).toHaveCount(0)
  await check()
  await expect(card()).toHaveCount(0)
  await closeApp(app)
  await closed
  await launch('available')
  await check()
  await expect(card()).toBeVisible()
})

test('Skip stays quiet across launches; a manual check still offers it', async () => {
  await launch('available')
  await check()
  await win.getByTestId('update-skip').click()
  await expect(card()).toHaveCount(0)
  await closeApp(app)
  await closed
  await launch('available')
  await check()
  await expect.poll(phase).toBe('idle')
  await expect(card()).toHaveCount(0)
  await check(true)
  await expect(card()).toBeVisible()
})

test('Install shows progress, and the app quits when ready', async () => {
  await launch('available')
  await check()
  await win.getByTestId('update-install').click()
  await expect(win.getByTestId('update-progress')).toBeVisible()
  await closed
  expect(isClosed).toBe(true)
})

test('A download finishing during a film waits', async () => {
  await launch('available', LIBRARY)
  const key = await keyOf(win, 'The Matrix')
  await check()
  await win.getByTestId('update-install').click()
  await play(key)
  const overlay = await overlayPage(app)
  await expect.poll(phase, { timeout: 8000 }).toBe('ready')
  const at = await position(overlay)
  await expect.poll(() => position(overlay), { timeout: 8000 }).toBeGreaterThan(at + 2)
  expect(isClosed).toBe(false)
  await closeWithX(overlay)
  await closed
  await launch('off')
  const title = await win.evaluate((k) => window.api.library.getTitle({ key: k }), key)
  expect(title!.main.label).toBe('Continue watching')
})

test('Enter on a card button only presses that button', async () => {
  await launch('available', LIBRARY)
  await focusTile(win, 'The Matrix')
  await check()
  await win.getByTestId('update-later').focus()
  await win.keyboard.press('Enter')
  await expect(card()).toHaveCount(0)
  await expect(win.getByTestId('title-page')).toHaveCount(0)
})

test('arrow keys on a card button leave the wall alone', async () => {
  await launch('available', LIBRARY)
  await focusTile(win, 'The Matrix')
  const live = await win.getByTestId('wall-live').textContent()
  await check()
  await win.getByTestId('update-later').focus()
  await win.keyboard.press('ArrowRight')
  await expect(win.getByTestId('update-later')).toBeFocused()
  await expect(win.getByTestId('wall-live')).toHaveText(live ?? '')
})

test('failed download offers retry', async () => {
  await launch('fail-download')
  await check()
  await win.getByTestId('update-install').click()
  await expect(win.getByTestId('update-retry')).toBeVisible()
  await expect(card()).toContainText("Couldn't download")
  expect(isClosed).toBe(false)
  // It can still be put off.
  await win.getByTestId('update-later').click()
  await expect(card()).toHaveCount(0)
})

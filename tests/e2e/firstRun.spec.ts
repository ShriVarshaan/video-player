/// <reference lib="dom" />
/// <reference path="../../src/preload/index.d.ts" />
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { LINKS } from '../../src/shared/links'
import { closeApp, goTo, launchApp } from './pages'

const LIBRARY = resolve('tests', 'fixtures', 'library')
const ON = { VP_FIRST_RUN: 'on' }
let app: ElectronApplication
let win: Page
let userData: string

test.beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'vp-e2e-'))
})

test.afterEach(async () => {
  await closeApp(app)
  rmSync(userData, { recursive: true, force: true })
})

async function launch(env: Record<string, string> = ON) {
  ;({ app, win } = await launchApp(null, userData, env))
}
const step = () => win.getByTestId('setup-step')
const check = () => win.getByTestId('setup-check')
const skip = () => win.getByTestId('setup-skip')
const message = () => win.getByTestId('setup-message')
const tmdbField = () => win.getByLabel('TMDB API key or read access token')

async function fillLogin(username: string) {
  await win.getByLabel('API key').fill('key')
  await win.getByLabel('Username').fill(username)
  await win.getByLabel('Password').fill('secret')
}

async function pickFolder(path: string | null) {
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = (async () => ({ canceled: p === null, filePaths: p ? [p] : [] })) as typeof dialog.showOpenDialog
  }, path)
}

async function toFolderStep() {
  await skip().click()
  await expect(step()).toHaveAttribute('data-step', 'opensubtitles')
  await skip().click()
  await expect(step()).toHaveAttribute('data-step', 'folder')
}

test('fresh launch shows step 1 and no menu or wall', async () => {
  await launch()
  await expect(step()).toHaveAttribute('data-step', 'tmdb')
  await expect(win.getByText('Step 1 of 3')).toBeVisible()
  await expect(win.getByRole('button', { name: 'Menu' })).toHaveCount(0)
  await expect(win.getByTestId('wall')).toHaveCount(0)
})

test('an existing library skips setup', async () => {
  await launch({})
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [p] })) as typeof dialog.showOpenDialog
  }, LIBRARY)
  await win.evaluate(() => window.api.library.addFolder({}))
  await closeApp(app)
  await launch()
  await expect(win.getByRole('button', { name: 'Menu' })).toBeVisible()
  await expect(step()).toHaveCount(0)
})

test('a good key moves on', async () => {
  await launch()
  await tmdbField().fill('test-key')
  await check().click()
  await expect(step()).toHaveAttribute('data-step', 'opensubtitles')
  expect((await win.evaluate(() => window.api.metadata.status({}))).hasKey).toBe(true)
})

test('a rejected key stays, says so, and the retry works', async () => {
  await launch()
  await tmdbField().fill('invalid')
  await check().click()
  await expect(message()).toContainText('TMDB did not accept')
  await expect(step()).toHaveAttribute('data-step', 'tmdb')
  await tmdbField().fill('test-key')
  await check().click()
  await expect(step()).toHaveAttribute('data-step', 'opensubtitles')
})

test('an unreachable service can save unchecked', async () => {
  await launch()
  await tmdbField().fill('offline')
  await check().click()
  await win.getByTestId('setup-unchecked').click()
  await expect(step()).toHaveAttribute('data-step', 'opensubtitles')
  expect((await win.evaluate(() => window.api.metadata.status({}))).hasKey).toBe(true)
})

test('a rejected login is not left saved on skip', async () => {
  await launch()
  await skip().click()
  await fillLogin('invalid')
  await check().click()
  await expect(message()).toBeVisible()
  await skip().click()
  await expect(step()).toHaveAttribute('data-step', 'folder')
  expect((await win.evaluate(() => window.api.subtitles.accountStatus({}))).configured).toBe(false)
})

test('a login that could not be checked is not kept on skip', async () => {
  await launch()
  await skip().click()
  await fillLogin('offline')
  await check().click()
  await expect(win.getByTestId('setup-unchecked')).toBeVisible()
  await skip().click()
  expect((await win.evaluate(() => window.api.subtitles.accountStatus({}))).configured).toBe(false)
})

test('Save without checking saves what is in the fields now', async () => {
  await launch()
  await skip().click()
  await fillLogin('offline')
  await check().click()
  await expect(win.getByTestId('setup-unchecked')).toBeVisible()
  await win.getByLabel('Username').fill('corrected')
  await win.getByTestId('setup-unchecked').click()
  await expect(step()).toHaveAttribute('data-step', 'folder')
  expect((await win.evaluate(() => window.api.subtitles.accountStatus({}))).username).toBe('corrected')
})

test('a corrected login moves on', async () => {
  await launch()
  await skip().click()
  await fillLogin('invalid')
  await check().click()
  await expect(message()).toBeVisible()
  await fillLogin('neo')
  await check().click()
  await expect(step()).toHaveAttribute('data-step', 'folder')
  expect((await win.evaluate(() => window.api.subtitles.accountStatus({}))).username).toBe('neo')
})

test('the folder step has no skip, and cancelling stays', async () => {
  await launch()
  await toFolderStep()
  await expect(skip()).toHaveCount(0)
  await pickFolder(null)
  await check().click()
  await win.waitForTimeout(300)
  await expect(step()).toHaveAttribute('data-step', 'folder')
})

test("finishing goes to the wall and doesn't come back", async () => {
  await launch()
  await toFolderStep()
  await pickFolder(LIBRARY)
  await check().click()
  await expect(win.locator('[data-testid="wall-tile"]:not([hidden])').first()).toBeVisible()
  await closeApp(app)
  await launch()
  await expect(win.getByRole('button', { name: 'Menu' })).toBeVisible()
  await expect(step()).toHaveCount(0)
  // Removing every folder later shows the empty wall, not setup.
  const folders = await win.evaluate(() => window.api.library.listFolders({}))
  for (const f of folders) await win.evaluate((id) => window.api.library.removeFolder({ id }), f.id)
  await closeApp(app)
  await launch()
  await expect(win.getByText('Your wall is empty')).toBeVisible()
  await expect(step()).toHaveCount(0)
})

test('links open in the browser only', async () => {
  await launch()
  const before = win.url()
  await app.evaluate(({ shell }) => {
    const g = globalThis as unknown as { opened: string[] }
    g.opened = []
    shell.openExternal = (async (url: string) => void g.opened.push(url)) as typeof shell.openExternal
  })
  await win.getByRole('button', { name: 'Create a free TMDB account' }).click()
  await expect
    .poll(() => app.evaluate(() => (globalThis as unknown as { opened: string[] }).opened))
    .toEqual([LINKS.tmdbSignup])
  expect(win.url()).toBe(before)
})

test('quitting mid-setup returns to step 1 with the key saved', async () => {
  await launch()
  await tmdbField().fill('test-key')
  await check().click()
  await expect(step()).toHaveAttribute('data-step', 'opensubtitles')
  await closeApp(app)
  await launch()
  await expect(step()).toHaveAttribute('data-step', 'tmdb')
  await expect(win.getByTestId('setup-saved')).toBeVisible()
  await check().click()
  await expect(step()).toHaveAttribute('data-step', 'opensubtitles')
})

test('the reminder shows on Home until a TMDB key is saved', async () => {
  await launch()
  await toFolderStep()
  await pickFolder(LIBRARY)
  await check().click()
  const reminder = win.getByTestId('tmdb-reminder')
  await expect(reminder).toBeVisible()
  await expect(win.locator('[data-testid="wall-tile"]:not([hidden])').first()).toBeVisible() // the wall takes keys now

  await win.keyboard.press('/')
  await expect(win.getByRole('searchbox')).toBeVisible()
  await expect(reminder).toHaveCount(0)
  await win.keyboard.press('Escape')
  await expect(reminder).toBeVisible()

  // Enter on its button goes to Settings and doesn't also open the focused wall title.
  await reminder.getByRole('button').focus()
  await win.keyboard.press('Enter')
  await expect(win.getByLabel('TMDB API key or read access token')).toBeVisible()
  await expect(win.getByTestId('title-page')).toHaveCount(0)
  await expect(reminder).toHaveCount(0)
  await win.getByLabel('TMDB API key or read access token').fill('test-key')
  await win.getByRole('button', { name: 'Save key' }).click()
  await expect(win.getByText('TMDB key saved')).toBeVisible()
  await goTo(win, 'Home')
  await expect(win.locator('[data-testid="wall-tile"]:not([hidden])').first()).toBeVisible()
  await expect(reminder).toHaveCount(0)
})

test('no reminder once a key is saved, and none when setup is off and a key exists', async () => {
  await launch()
  await tmdbField().fill('test-key')
  await check().click()
  await skip().click()
  await pickFolder(LIBRARY)
  await check().click()
  await expect(win.locator('[data-testid="wall-tile"]:not([hidden])').first()).toBeVisible()
  await expect(win.getByTestId('tmdb-reminder')).toHaveCount(0)
})

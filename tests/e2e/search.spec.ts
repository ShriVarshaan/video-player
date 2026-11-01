/// <reference lib="dom" />
/// <reference path="../../src/preload/index.d.ts" />
import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { closeApp, focusTile, goTo, launchApp } from './pages'

// The fixture library: The Matrix, Inception, Amélie (TMDB fixtures with cast and
// directors), Breaking Bad (a show), Some Unknown Home Video (unmatched, no art).
const LIBRARY = resolve('tests', 'fixtures', 'library')
let dir: string
let app: ElectronApplication
let win: Page
let userData: string

test.beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'vp-e2e-search-'))
  cpSync(LIBRARY, dir, { recursive: true })
  ;({ app, win, userData } = await launchApp(dir))
  // Wait until TMDB matching has filled in people (search matches on them).
  await expect
    .poll(() => win.evaluate(async () => (await window.api.library.searchDocs({})).find((d) => d.title === 'Inception')?.directors.length ?? 0), { timeout: 20_000 })
    .toBeGreaterThan(0)
})

test.afterEach(async () => {
  await closeApp(app)
  rmSync(userData, { recursive: true, force: true })
  rmSync(dir, { recursive: true, force: true })
})

const box = () => win.getByRole('searchbox')
const cards = () => win.getByTestId('search-card')
const selected = () => win.locator('[data-testid="search-card"][aria-selected="true"]')

test('typing on the wall opens search with the letter and the title first', async () => {
  await focusTile(win, 'The Matrix')
  await win.keyboard.type('matr')
  await expect(box()).toHaveValue('matr')
  await expect(cards().first()).toHaveAttribute('aria-label', 'The Matrix (1999)')
  await expect(cards().first()).toHaveAttribute('aria-selected', 'true')
})

test('Enter right after typing opens the typed title', async () => {
  await win.keyboard.press('/')
  await expect(box()).toBeFocused()
  await box().pressSequentially('inception')
  await win.keyboard.press('Enter')
  await expect(win.getByTestId('title-heading')).toHaveText('Inception')
})

test('back from the title page returns to the search', async () => {
  await win.keyboard.press('/')
  await box().pressSequentially('inception')
  await win.keyboard.press('Enter')
  await expect(win.getByTestId('title-heading')).toHaveText('Inception')
  await win.keyboard.press('Escape')
  await expect(box()).toHaveValue('inception')
  await expect(selected()).toHaveAttribute('aria-label', 'Inception (2010)')
})

test('Esc clears, then closes to the same tile', async () => {
  await focusTile(win, 'The Matrix')
  await win.keyboard.press('x')
  await expect(box()).toHaveValue('x')
  await win.keyboard.press('Escape')
  await expect(box()).toHaveValue('')
  await win.keyboard.press('Escape')
  await expect(box()).toHaveCount(0)
  await expect(win.getByTestId('wall-live')).toHaveText(/^The Matrix/)
})

test('the menu opens search', async () => {
  await goTo(win, 'Search')
  await expect(box()).toBeVisible()
  await expect(box()).toBeFocused()
})

test('↓ goes to the chips, then the cards', async () => {
  await win.keyboard.press('/')
  await box().pressSequentially('inception')
  await expect(cards().first()).toHaveAttribute('aria-label', 'Inception (2010)')
  await win.keyboard.press('ArrowDown')
  await expect(win.locator('[data-testid="search-chip"]:focus')).toHaveCount(1)
  await win.keyboard.press('ArrowDown')
  await expect(cards().first()).toBeFocused()
})

test('a chip narrows the results', async () => {
  await win.keyboard.press('/')
  await box().pressSequentially('inception')
  await win.getByTestId('search-chip').first().click()
  await expect(box()).toHaveValue(/^(cast:|director:|genre:|\d{4}s$)/)
  await expect(cards().first()).toBeVisible()
  await expect(box()).toBeFocused()
})

test('no matches', async () => {
  await win.keyboard.press('/')
  await box().pressSequentially('zzzzqq')
  await expect(win.getByText('Your search for “zzzzqq” did not have any matches.')).toBeVisible()
  await expect(win.getByTestId('search-chip').first()).toBeVisible()
})

test('empty query shows rows', async () => {
  await win.keyboard.press('/')
  await expect(win.getByRole('heading', { name: 'Recently added' })).toBeVisible()
  await expect(cards().first()).toBeVisible()
})

test('a card without art shows its title', async () => {
  await win.keyboard.press('/')
  await box().pressSequentially('home video')
  await expect(cards().first()).toContainText('Some Unknown Home Video')
})

test('a show opens its page', async () => {
  await win.keyboard.press('/')
  await box().pressSequentially('breaking')
  await expect(cards().first()).toHaveAttribute('aria-label', 'Breaking Bad (2008)')
  await win.keyboard.press('Enter')
  await expect(win.getByTestId('season-tab').first()).toBeVisible()
})

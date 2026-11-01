import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { goTo, toSecondDisplay } from './pages'

let userData: string
let app: ElectronApplication
let win: Page

test.beforeEach(async () => {
  userData = mkdtempSync(join(tmpdir(), 'vp-e2e-nav-'))
  app = await electron.launch({ args: ['out/main/index.js', `--user-data-dir=${userData}`] })
  win = await app.firstWindow()
  await toSecondDisplay(app)
})

test.afterEach(async () => {
  await app.close()
  rmSync(userData, { recursive: true, force: true })
})

test('opens on Home', async () => {
  await expect(win.getByTestId('wall-home')).toBeVisible()
})

test('the menu opens a drawer with Search, Home and Settings, and Escape closes it', async () => {
  const menu = win.getByRole('button', { name: 'Menu' })
  await expect(menu).toHaveAttribute('aria-expanded', 'false')
  await menu.click()
  await expect(menu).toHaveAttribute('aria-expanded', 'true')

  const nav = win.getByRole('navigation', { name: 'Main' })
  await expect(nav.getByRole('button')).toHaveText(['Search', 'Home', 'Settings'])
  await expect(nav.getByRole('button', { name: 'Home' })).toHaveAttribute('aria-current', 'page')
  // A mouse open puts no focus ring on an entry, but keys still work in the drawer.
  await expect(nav.getByRole('button', { name: 'Home' })).not.toBeFocused()

  await win.keyboard.press('Escape')
  await expect(nav).toBeHidden()
  await expect(menu).toBeFocused()
})

test('opening the menu from the keyboard focuses the current page', async () => {
  await win.getByRole('button', { name: 'Menu' }).focus()
  await win.keyboard.press('Enter')
  await expect(win.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Home' })).toBeFocused()
  await win.keyboard.press('ArrowDown')
  await win.keyboard.press('Enter')
  await expect(win.getByRole('heading', { name: 'Settings' })).toBeVisible()
  await expect(win.getByRole('button', { name: 'Menu' })).toBeFocused()
})

test('picking a page with the mouse leaves no focus ring behind', async () => {
  await goTo(win, 'Settings')
  expect(await win.evaluate(() => document.activeElement === document.body)).toBe(true)
})

test('switches between Settings, Search and Home', async () => {
  await goTo(win, 'Settings')
  await expect(win.getByRole('heading', { name: 'Settings' })).toBeVisible()
  await expect(win.getByText('This product uses the TMDB API but is not endorsed or certified by TMDB.')).toBeVisible()
  await expect(win.getByRole('navigation', { name: 'Main' })).toBeHidden()

  await goTo(win, 'Search')
  await expect(win.getByRole('searchbox')).toBeVisible()

  await goTo(win, 'Home')
  await expect(win.getByTestId('wall-home')).toBeVisible()
})

test('arrow keys move through the drawer and Enter picks', async () => {
  await win.getByRole('button', { name: 'Menu' }).click()
  await win.keyboard.press('ArrowDown')
  await win.keyboard.press('Enter')
  await expect(win.getByRole('heading', { name: 'Settings' })).toBeVisible()
})

test('clicking outside the drawer closes it', async () => {
  await win.getByRole('button', { name: 'Menu' }).click()
  await win.mouse.click(900, 400)
  await expect(win.getByRole('navigation', { name: 'Main' })).toBeHidden()
})

test('Tab stays out of the dimmed page while the drawer is open', async () => {
  await goTo(win, 'Settings')
  await win.getByRole('button', { name: 'Menu' }).focus()
  await win.keyboard.press('Enter')
  for (let i = 0; i < 6; i++) {
    await win.keyboard.press('Tab')
    const inside = await win.evaluate(() => {
      const a = document.activeElement
      return !!a && (a === document.body || !!a.closest('nav') || a.getAttribute('aria-label') === 'Menu')
    })
    expect(inside).toBe(true)
  }
})

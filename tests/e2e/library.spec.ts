/// <reference lib="dom" />
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { focusTile, goTo, wallTitles, toSecondDisplay } from './pages'

const LIBRARY = resolve('tests', 'fixtures', 'library')
let userData: string
let app: ElectronApplication
let win: Page

test.beforeAll(() => {
  execFileSync(process.execPath, ['scripts/make-fixtures.mjs'], { stdio: 'inherit' })
})

test.beforeEach(async () => {
  userData = mkdtempSync(join(tmpdir(), 'vp-e2e-lib-'))
  app = await electron.launch({
    args: ['out/main/index.js', `--user-data-dir=${userData}`],
    env: { ...process.env, VP_TMDB_MODE: 'fixtures' }
  })
  win = await app.firstWindow()
  await toSecondDisplay(app)
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as typeof dialog.showOpenDialog
  }, LIBRARY)
})

test.afterEach(async () => {
  await app.close()
  rmSync(userData, { recursive: true, force: true })
})

async function addLibrary() {
  await goTo(win, 'Settings')
  await win.getByLabel('TMDB API key or read access token').fill('test-key')
  await win.getByRole('button', { name: 'Save key' }).click()
  await expect(win.getByText('TMDB key saved')).toBeVisible()
  await win.getByRole('button', { name: 'Add folder' }).click()
  await expect(win.getByTestId('folder-row')).toHaveCount(1)
  await expect(win.getByTestId('folder-row')).toContainText(LIBRARY)
}

test('scans, matches and puts every title on the wall with artwork', async () => {
  await addLibrary()
  await goTo(win, 'Home')
  await expect
    .poll(() => wallTitles(win), { timeout: 30_000 })
    .toEqual(expect.arrayContaining(['Amélie', 'Breaking Bad', 'Inception', 'Some Unknown Home Video', 'The Matrix']))
  expect(await wallTitles(win)).toHaveLength(5)

  // Every poster is served through poster:// as a 400 px WebP: TMDB art for
  // matched titles, a frame from the video for the home video.
  await expect
    .poll(
      () =>
        win.evaluate(() => {
          const tiles = [...document.querySelectorAll<HTMLElement>('[data-testid="wall-tile"]:not([hidden])')]
          return tiles.length > 0 && tiles.every((t) => t.querySelector('img')?.naturalWidth === 400 && !t.classList.contains('generated'))
        }),
      { timeout: 30_000 }
    )
    .toBe(true)
})

test("a matched movie's card shows its TMDB details", async () => {
  await addLibrary()
  await goTo(win, 'Home')
  await expect.poll(() => wallTitles(win), { timeout: 30_000 }).toContain('The Matrix')
  await focusTile(win, 'The Matrix')
  await expect(win.getByTestId('info-card')).toContainText('1999')
  await expect(win.getByTestId('info-card').getByRole('button', { name: 'Play' })).toBeEnabled()
})

test('removing the folder asks first, then empties the wall', async () => {
  await addLibrary()
  await goTo(win, 'Home')
  await expect.poll(() => wallTitles(win), { timeout: 30_000 }).toHaveLength(5)
  await goTo(win, 'Settings')

  await win.getByRole('button', { name: 'Remove' }).click()
  await expect(win.getByText('Remove this folder? Watch progress for its videos will be deleted.')).toBeVisible()
  await win.getByRole('button', { name: 'Cancel' }).click()
  await expect(win.getByTestId('folder-row')).toHaveCount(1)

  await win.getByRole('button', { name: 'Remove' }).click()
  await win.getByRole('dialog').getByRole('button', { name: 'Remove' }).click()
  await expect(win.getByTestId('folder-row')).toHaveCount(0)
  await goTo(win, 'Home')
  await expect(win.getByRole('button', { name: 'Choose a folder' })).toBeVisible()
})

test('shows the TMDB credit line', async () => {
  await goTo(win, 'Settings')
  await expect(win.getByText('This product uses the TMDB API but is not endorsed or certified by TMDB.')).toBeVisible()
})

/// <reference lib="dom" />
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { goTo } from './pages'

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

// The movie and show lists left with the placeholder; Task 5 re-points these at the wall.
test.fixme('scans, matches and shows the library with artwork', async () => {
  await addLibrary()

  const movies = win.getByTestId('movie-item')
  await expect(movies).toHaveCount(4, { timeout: 30_000 })
  await expect(movies).toHaveText([/Amélie/, /Inception/, /Some Unknown Home Video/, /The Matrix/])
  await expect(movies.filter({ hasText: 'The Matrix' })).toContainText('1999')

  const shows = win.getByTestId('show-item')
  await expect(shows).toHaveCount(1)
  await expect(shows).toContainText('Breaking Bad')
  await expect(shows).toContainText('3 episodes')

  // Every poster is served through poster:// as a 400 px WebP: TMDB art for
  // matched titles, a frame from the video for the home video.
  await expect
    .poll(
      () =>
        win.evaluate(() =>
          [...document.querySelectorAll<HTMLImageElement>('[data-testid="movie-item"] img')].map((i) => i.naturalWidth)
        ),
      { timeout: 30_000 }
    )
    .toEqual([400, 400, 400, 400])
})

test.fixme('opens a show with its seasons, episodes and next episode', async () => {
  await addLibrary()
  await win.getByTestId('show-item').click({ timeout: 30_000 })

  await expect(win.getByRole('heading', { name: 'Season 1' })).toBeVisible()
  await expect(win.getByRole('heading', { name: 'Season 2' })).toBeVisible()
  await expect(win.getByTestId('episode-item')).toHaveCount(3)
  await expect(win.getByTestId('episode-item').first()).toContainText('Pilot')
  await expect(win.getByTestId('next-up')).toContainText('Play episode')
  await expect(win.getByTestId('next-up')).toContainText('S1 · E1')
})

test.fixme('removing the folder asks first, then clears the library', async () => {
  await addLibrary()
  await expect(win.getByTestId('movie-item')).toHaveCount(4, { timeout: 30_000 })

  await win.getByRole('button', { name: 'Remove' }).click()
  await expect(win.getByText('Remove this folder? Watch progress for its videos will be deleted.')).toBeVisible()
  await win.getByRole('button', { name: 'Cancel' }).click()
  await expect(win.getByTestId('folder-row')).toHaveCount(1)

  await win.getByRole('button', { name: 'Remove' }).click()
  await win.getByRole('dialog').getByRole('button', { name: 'Remove' }).click()
  await expect(win.getByTestId('folder-row')).toHaveCount(0)
  await expect(win.getByTestId('movie-item')).toHaveCount(0)
})

test('shows the TMDB credit line', async () => {
  await goTo(win, 'Settings')
  await expect(win.getByText('This product uses the TMDB API but is not endorsed or certified by TMDB.')).toBeVisible()
})

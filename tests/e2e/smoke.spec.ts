/// <reference lib="dom" />
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { LINKS } from '../../src/shared/links'
import { goTo, mainWindow, toSecondDisplay } from './pages'

let userData: string
let app: ElectronApplication

test.beforeEach(async () => {
  userData = mkdtempSync(join(tmpdir(), 'vp-e2e-'))
  app = await electron.launch({ args: ['out/main/index.js', `--user-data-dir=${userData}`], env: { ...process.env, VP_FIRST_RUN: 'off' } })
})

test.afterEach(async () => {
  await app.close()
  rmSync(userData, { recursive: true, force: true })
})

test('opens the shell and creates the database in userData', async () => {
  const win = await app.firstWindow()
  await toSecondDisplay(app)
  await goTo(win, 'Settings')
  await expect(win.getByTestId('db-path')).toHaveText(join(userData, 'library.db'))
  const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }
  await expect(win.getByTestId('version')).toHaveText(version)
  expect(existsSync(join(userData, 'library.db'))).toBe(true)

  // In development the binaries come from <repo>/vendor (npm run fetch-vendor).
  const vendored = {
    mpv: join('vendor', 'mpv', 'mpv.exe'),
    ffmpeg: join('vendor', 'ffmpeg', 'ffmpeg.exe'),
    ffprobe: join('vendor', 'ffmpeg', 'ffprobe.exe')
  }
  for (const [name, file] of Object.entries(vendored)) {
    await expect(win.getByTestId(`bin-${name}`)).toHaveAttribute('data-exists', String(existsSync(file)))
  }
})

test('About shows the licences, credits and source links', async () => {
  const win = await mainWindow(app)
  await toSecondDisplay(app)
  await app.evaluate(({ shell }) => {
    const g = globalThis as unknown as { opened: string[] }
    g.opened = []
    shell.openExternal = (async (url: string) => void g.opened.push(url)) as typeof shell.openExternal
  })
  await goTo(win, 'Settings')
  await expect(win.getByText('Cinewall is free software under the MIT licence.')).toBeVisible()
  await expect(win.getByText('This product uses the TMDB API but is not endorsed or certified by TMDB.')).toBeVisible()
  await expect.poll(() => win.getByTestId('tmdb-logo').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0)

  await win.getByRole('button', { name: 'Source on GitHub' }).click()
  await win.getByRole('button', { name: 'mpv source' }).click()
  await win.getByRole('button', { name: 'FFmpeg source' }).click()
  await win.getByRole('button', { name: 'The Movie Database' }).click()
  await expect
    .poll(() => app.evaluate(() => (globalThis as unknown as { opened: string[] }).opened))
    .toEqual([LINKS.repo, LINKS.mpvSource, LINKS.ffmpegSource, LINKS.tmdb])

  await win.getByRole('button', { name: 'Show third-party notices' }).click()
  await expect(win.getByTestId('notices')).toContainText('mpv')
  await expect(win.getByTestId('notices')).toContainText('GNU GENERAL PUBLIC LICENSE')
  await win.getByRole('button', { name: 'Hide third-party notices' }).click()
  await expect(win.getByTestId('notices')).toHaveCount(0)
})

test('the window is called Cinewall', async () => {
  const win = await app.firstWindow()
  await toSecondDisplay(app)
  await expect(win).toHaveTitle('Cinewall')
})

test('the window cannot be navigated away or open new windows', async () => {
  const win = await app.firstWindow()
  await toSecondDisplay(app)
  await goTo(win, 'Settings')
  await expect(win.getByTestId('db-path')).toBeVisible()
  const before = win.url()

  // What dropping a file onto the window, or following a link, would do.
  await win.evaluate(() => {
    window.location.href = 'file:///C:/Windows/win.ini'
  })
  await win.waitForTimeout(500)
  expect(win.url()).toBe(before)
  // Read the DOM directly: Playwright's locators wait forever on a cancelled navigation.
  expect(
    await win.evaluate(() => document.querySelector('[data-testid="db-path"]')?.textContent)
  ).toBe(join(userData, 'library.db'))

  expect(await win.evaluate(() => window.open('https://example.com') === null)).toBe(true)
  // The player's overlay window exists, hidden, from startup; nothing else may open.
  expect(app.windows().filter((w) => !w.url().endsWith('overlay.html'))).toHaveLength(1)
})

test('a second instance exits and leaves the first running', async () => {
  const win = await app.firstWindow()
  await toSecondDisplay(app)
  await goTo(win, 'Settings')
  await expect(win.getByTestId('db-path')).toBeVisible()

  const electronPath = require('electron') as unknown as string
  const second = spawn(electronPath, ['out/main/index.js', `--user-data-dir=${userData}`])
  const code = await new Promise<number | null>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('second instance still running after 5 s')), 5000)
    second.on('exit', (c) => {
      clearTimeout(timer)
      resolve(c)
    })
  })

  expect(code).toBe(0)
  await expect(win.getByRole('heading', { name: 'Settings' })).toBeVisible()
})

/// <reference lib="dom" />
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { goTo } from './pages'

let userData: string
let app: ElectronApplication

test.beforeEach(async () => {
  userData = mkdtempSync(join(tmpdir(), 'vp-e2e-'))
  app = await electron.launch({ args: ['out/main/index.js', `--user-data-dir=${userData}`] })
})

test.afterEach(async () => {
  await app.close()
  rmSync(userData, { recursive: true, force: true })
})

test('opens the shell and creates the database in userData', async () => {
  const win = await app.firstWindow()
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

test('the window cannot be navigated away or open new windows', async () => {
  const win = await app.firstWindow()
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
  expect(app.windows()).toHaveLength(1)
})

test('a second instance exits and leaves the first running', async () => {
  const win = await app.firstWindow()
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

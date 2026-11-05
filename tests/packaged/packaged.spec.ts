/// <reference lib="dom" />
/// <reference path="../../src/preload/index.d.ts" />
import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { closeApp, goTo, keyOf, mainWindow, overlayPage, overlayVisible, position, toSecondDisplay } from '../e2e/pages'

const UNPACKED = resolve('release', 'win-unpacked')
let root: string
let installed: string
let userData: string
let app: ElectronApplication
let win: Page

// Not cpSync: on Windows it garbles non-ASCII destination names (Node 24).
function copyTree(from: string, to: string) {
  mkdirSync(to, { recursive: true })
  for (const e of readdirSync(from, { withFileTypes: true })) {
    if (e.isDirectory()) copyTree(join(from, e.name), join(to, e.name))
    else copyFileSync(join(from, e.name), join(to, e.name))
  }
}

// A folder with a space and accents, as a Windows user name or install folder can have.
test.beforeAll(() => {
  if (!existsSync(UNPACKED)) throw new Error('Run npm run package first: release/win-unpacked is missing.')
  root = mkdtempSync(join(tmpdir(), 'cinewall-packaged-'))
  installed = join(root, 'Cinewall Tést Ñ')
  copyTree(UNPACKED, installed)
})

test.afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 })
})

test.beforeEach(async () => {
  userData = mkdtempSync(join(root, 'data é '))
  app = await electron.launch({
    executablePath: join(installed, 'Cinewall.exe'),
    args: [`--user-data-dir=${userData}`],
    // Shipped builds must ignore every development switch.
    env: { ...process.env, VP_TMDB_MODE: 'fixtures', VP_OPENSUBS_MODE: 'fixtures', VP_FIRST_RUN: 'off', VP_UPDATE_MODE: 'available' }
  })
  win = await mainWindow(app)
  await toSecondDisplay(app)
})

test.afterEach(async () => {
  await closeApp(app)
})

test('the installed app stands alone', async () => {
  await expect(win).toHaveTitle('Cinewall')
  const info = await win.evaluate(() => window.api.app.getInfo({}))
  expect(info.version).toBe('1.0.0')
  expect(typeof info.hour12).toBe('boolean') // koffi loaded from outside the asar
  expect(Object.values(info.binaries).every((b) => b.exists)).toBe(true)
  // Fixture mode would accept this key; a shipped build asks TMDB, which doesn't.
  await expect(win.evaluate(() => window.api.metadata.setTmdbKey({ key: 'test-key' }))).rejects.toThrow()

  const library = join(root, 'Films é')
  mkdirSync(library, { recursive: true })
  copyFileSync(resolve('tests', 'fixtures', 'media', 'h264_like.mp4'), join(library, 'Stand Alone (2001).mp4'))
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as typeof dialog.showOpenDialog
  }, library)
  // VP_FIRST_RUN=off is ignored, so a new install starts in setup.
  await expect(win.getByTestId('setup-step')).toHaveAttribute('data-step', 'tmdb')
  await win.getByTestId('setup-skip').click()
  await win.getByTestId('setup-skip').click()
  await expect(win.getByTestId('setup-step')).toHaveAttribute('data-step', 'folder')
  await win.getByTestId('setup-check').click()
  await expect(win.locator('[data-testid="wall-tile"]:not([hidden])').first()).toBeVisible() // ffprobe ran

  const key = await keyOf(win, 'Stand Alone')
  await win.evaluate((k) => window.api.player.play({ key: k }), key)
  const overlay = await overlayPage(app)
  await expect.poll(() => overlayVisible(app)).toBe(true)
  await expect.poll(() => position(overlay), { timeout: 15_000 }).toBeGreaterThan(0.5) // mpv plays
})

test('About is written for people using the app, and has its notices', async () => {
  await win.getByTestId('setup-skip').click()
  await win.getByTestId('setup-skip').click()
  const library = join(root, 'Films about')
  mkdirSync(library, { recursive: true })
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as typeof dialog.showOpenDialog
  }, library)
  await win.getByTestId('setup-check').click()
  await goTo(win, 'Settings')
  await expect(win.getByTestId('version')).toHaveText('1.0.0')
  await expect(win.getByTestId('db-path')).toHaveCount(0)
  await expect(win.getByTestId('bin-mpv')).toHaveCount(0)
  await expect(win.getByTestId('binaries-missing')).toHaveCount(0)
  await win.getByRole('button', { name: 'Show third-party notices' }).click()
  await expect(win.getByTestId('notices')).toContainText('GNU GENERAL PUBLIC LICENSE')
})

test('the bundled sidecar answers', async () => {
  const exe = join(installed, 'resources', 'sidecar', 'vp-sync', 'vp-sync.exe')
  const reply = await new Promise<string>((done, fail) => {
    const p = spawn(exe, [], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true })
    const timer = setTimeout(() => (p.kill(), fail(new Error('no reply'))), 30_000)
    p.on('error', fail)
    p.stdout.once('data', (d: Buffer) => {
      clearTimeout(timer)
      p.kill()
      done(d.toString())
    })
    p.stdin.write(`${JSON.stringify({ id: 1, method: 'ping' })}\n`)
  })
  expect(JSON.parse(reply.split('\n')[0]!)).toMatchObject({ id: 1 })
})

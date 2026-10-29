/// <reference lib="dom" />
import { copyFileSync, cpSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { clickAnyTile, goTo, openTile, wallTitles } from './pages'

const LIBRARY = resolve('tests', 'fixtures', 'library')
const ALL_TITLES = ['Amélie', 'Breaking Bad', 'Inception', 'Some Unknown Home Video', 'The Matrix']
let userData: string
let app: ElectronApplication
let win: Page
const cleanup: string[] = []

async function launch(folder: string | null) {
  userData = mkdtempSync(join(tmpdir(), 'vp-e2e-wall-'))
  app = await electron.launch({
    args: ['out/main/index.js', `--user-data-dir=${userData}`],
    env: { ...process.env, VP_TMDB_MODE: 'fixtures' }
  })
  win = await app.firstWindow()
  if (!folder) return
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as typeof dialog.showOpenDialog
  }, folder)
  await goTo(win, 'Settings')
  await win.getByLabel('TMDB API key or read access token').fill('test-key')
  await win.getByRole('button', { name: 'Save key' }).click()
  await win.getByRole('button', { name: 'Add folder' }).click()
  await expect(win.getByTestId('folder-row')).toHaveCount(1)
  await goTo(win, 'Home')
}

test.afterEach(async () => {
  await app.close()
  rmSync(userData, { recursive: true, force: true })
  for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true })
})

test.describe('with the fixture library', () => {
  test.beforeEach(async () => {
    await launch(LIBRARY)
    await expect.poll(() => wallTitles(win), { timeout: 30_000 }).toEqual(expect.arrayContaining(ALL_TITLES))
  })

  test('fills the screen with repeating tiles', async () => {
    expect(await win.getByTestId('wall-tile').count()).toBeGreaterThan(5)
    expect((await wallTitles(win)).sort()).toEqual(ALL_TITLES)
  })

  test('arrow keys move focus, announce it and show the info card', async () => {
    const live = win.getByTestId('wall-live')
    await expect(live).not.toBeEmpty()
    const seen = new Set([await live.textContent()])
    for (let i = 0; i < 5; i++) {
      await win.keyboard.press('ArrowRight')
      seen.add(await live.textContent())
    }
    expect(seen.size).toBeGreaterThan(1)
    const title = (await live.textContent())!.split(',')[0]!
    await expect(win.getByTestId('info-card')).toContainText(title, { timeout: 2000 })
    await expect(win.locator('[data-testid="wall-tile"][data-focused="true"]')).toHaveCount(1)
  })

  test('dragging pans the wall', async () => {
    const plane = win.getByTestId('wall-plane')
    const before = await plane.getAttribute('style')
    await win.mouse.move(600, 400)
    await win.mouse.down()
    await win.mouse.move(450, 300, { steps: 8 })
    await win.mouse.up()
    await expect.poll(() => plane.getAttribute('style')).not.toBe(before)
  })

  test('the wall ignores keys while the menu is open', async () => {
    const live = win.getByTestId('wall-live')
    await expect(live).not.toBeEmpty()
    const before = await live.textContent()
    await win.getByRole('button', { name: 'Menu' }).click()
    await win.keyboard.press('ArrowRight')
    await win.keyboard.press('ArrowRight')
    await expect(live).toHaveText(before!)
  })

  test('clicking a tile focuses it and opens its card', async () => {
    const title = await clickAnyTile(win)
    await expect(win.getByTestId('wall-live')).toHaveText(new RegExp(`^${title}`))
    await expect(win.getByTestId('info-card')).toContainText(title)
  })

  test("a show's card counts seasons and episodes, with Play disabled until playback exists", async () => {
    await openTile(win, 'Breaking Bad')
    const card = win.getByTestId('info-card')
    await expect(card).toContainText('Breaking Bad')
    await expect(card).toContainText('2 seasons · 3 episodes')
    await expect(card.getByRole('button', { name: 'Play episode' })).toBeDisabled()
    await expect(card).toContainText('Playback arrives in a later update')
  })

  test('typing a letter opens Search', async () => {
    await win.keyboard.press('k')
    await expect(win.getByRole('heading', { name: 'Search' })).toBeVisible()
  })

  test('keeps focus on the same title when the library changes', async () => {
    await openTile(win, 'The Matrix')
    await expect(win.getByTestId('wall-live')).toHaveText(/^The Matrix/)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.send('vp:event.library.changed', {}))
    await win.waitForTimeout(500)
    await expect(win.locator('[data-testid="wall-tile"][data-focused="true"]')).toHaveAttribute('data-title', 'The Matrix')
  })

  test('remembers its place after visiting another page', async () => {
    await win.keyboard.press('ArrowDown')
    await win.waitForTimeout(1500) // let the camera spring settle
    const live = await win.getByTestId('wall-live').textContent()
    const style = await win.getByTestId('wall-plane').getAttribute('style')
    await goTo(win, 'Settings')
    await goTo(win, 'Home')
    await expect(win.getByTestId('wall-live')).toHaveText(live!)
    expect(await win.getByTestId('wall-plane').getAttribute('style')).toBe(style)
  })
})

test('an empty library offers to choose a folder', async () => {
  await launch(null)
  await win.getByRole('button', { name: 'Choose a folder' }).click()
  await expect(win.getByRole('heading', { name: 'Settings' })).toBeVisible()
})

test('a single title still fills the wall', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vp-e2e-one-'))
  cleanup.push(dir)
  copyFileSync(resolve('tests', 'fixtures', 'media', 'h264_like.mp4'), join(dir, 'Lonely Film (2020).mp4'))
  await launch(dir)
  await expect.poll(() => wallTitles(win), { timeout: 30_000 }).toEqual(['Lonely Film'])
  expect(await win.locator('[data-testid="wall-tile"]:not([hidden])').count()).toBeGreaterThan(4)
  await win.keyboard.press('ArrowRight')
  await win.keyboard.press('ArrowDown')
  await expect(win.getByTestId('wall-live')).toHaveText('Lonely Film, 2020')
})

test.describe('review fixes', () => {
  test('a recycled tile never shows another title’s poster', async () => {
    await launch(LIBRARY)
    await expect.poll(() => wallTitles(win), { timeout: 30_000 }).toEqual(expect.arrayContaining(ALL_TITLES))
    // Sample every frame during fast drags: a tile showing its image must show its own poster.
    await win.evaluate(() => {
      const w = window as unknown as { __bad: string[]; __sampling: boolean }
      w.__bad = []
      w.__sampling = true
      const check = () => {
        for (const t of document.querySelectorAll<HTMLElement>('[data-testid="wall-tile"]:not([hidden])')) {
          if (t.classList.contains('loading') || t.classList.contains('generated')) continue
          const src = t.querySelector('img')?.getAttribute('src')
          if (src !== t.dataset.poster) w.__bad.push(`${t.dataset.title}: ${src} != ${t.dataset.poster}`)
        }
        if (w.__sampling) requestAnimationFrame(check)
      }
      requestAnimationFrame(check)
    })
    for (let i = 0; i < 4; i++) {
      await win.mouse.move(1100, 600)
      await win.mouse.down()
      await win.mouse.move(100, 100, { steps: 6 })
      await win.mouse.up()
    }
    await win.waitForTimeout(800)
    const bad = await win.evaluate(() => {
      const w = window as unknown as { __bad: string[]; __sampling: boolean }
      w.__sampling = false
      return w.__bad
    })
    expect(bad.slice(0, 5)).toEqual([])
  })

  test('holding an arrow keeps repeating through a library refresh', async () => {
    await launch(LIBRARY)
    await expect.poll(() => wallTitles(win), { timeout: 30_000 }).toEqual(expect.arrayContaining(ALL_TITLES))
    const live = win.getByTestId('wall-live')
    await win.keyboard.down('ArrowRight')
    await win.waitForTimeout(400)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.send('vp:event.library.changed', {}))
    await win.waitForTimeout(150)
    // Sample the announced title; a stopped repeat announces only one.
    const seen = new Set<string | null>()
    for (let i = 0; i < 8; i++) {
      seen.add(await live.textContent())
      await win.waitForTimeout(70)
    }
    await win.keyboard.up('ArrowRight')
    expect(seen.size).toBeGreaterThan(1)
  })

  test('focus follows its title when the library really changes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vp-e2e-grow-'))
    cleanup.push(dir)
    cpSync(LIBRARY, dir, { recursive: true })
    await launch(dir)
    await expect.poll(() => wallTitles(win), { timeout: 30_000 }).toEqual(expect.arrayContaining(ALL_TITLES))
    await openTile(win, 'Inception')
    copyFileSync(resolve('tests', 'fixtures', 'media', 'h264_like.mp4'), join(dir, 'Lonely Film (2020).mp4'))
    await expect.poll(() => wallTitles(win), { timeout: 30_000 }).toContain('Lonely Film')
    const focused = win.locator('[data-testid="wall-tile"][data-focused="true"]')
    await expect(focused).toHaveAttribute('data-title', 'Inception')
    await expect(win.getByTestId('wall-live')).toHaveText(/^Inception/)
    // The camera follows it on screen.
    await expect
      .poll(() => focused.evaluate((t) => { const r = t.getBoundingClientRect(); return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight }))
      .toBe(true)
  })

  test('resizing the window keeps the focused tile where it was', async () => {
    await launch(LIBRARY)
    await expect.poll(() => wallTitles(win), { timeout: 30_000 }).toEqual(expect.arrayContaining(ALL_TITLES))
    const centreOffset = () =>
      win.locator('[data-testid="wall-tile"][data-focused="true"]').evaluate((t) => {
        const r = t.getBoundingClientRect()
        return { x: r.left + r.width / 2 - innerWidth / 2, y: r.top + r.height / 2 - innerHeight / 2, w: (t as HTMLElement).offsetWidth }
      })
    const before = await centreOffset()
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1920, 1080))
    await expect.poll(async () => (await centreOffset()).w).not.toBe(before.w)
    await win.waitForTimeout(300)
    const after = await centreOffset()
    const ratio = after.w / before.w
    expect(Math.abs(after.x - before.x * ratio)).toBeLessThan(40)
    expect(Math.abs(after.y - before.y * ratio)).toBeLessThan(40)
  })

  test('the backdrop clears when the next title has no usable art', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vp-e2e-noart-'))
    cleanup.push(dir)
    copyFileSync(join(LIBRARY, 'The.Matrix.1999.1080p.BluRay.x264.mkv'), join(dir, 'The.Matrix.1999.1080p.BluRay.x264.mkv'))
    copyFileSync(resolve('tests', 'fixtures', 'media', 'truncated.mp4'), join(dir, 'Broken Film (2001).mp4'))
    await launch(dir)
    await expect.poll(() => wallTitles(win), { timeout: 30_000 }).toEqual(['Broken Film', 'The Matrix'].sort())
    await openTile(win, 'The Matrix')
    await expect(win.locator('.backdrop-layer.shown')).toHaveCount(1, { timeout: 3000 })
    await openTile(win, 'Broken Film')
    await expect(win.getByTestId('info-card')).toContainText('Broken Film')
    await win.waitForTimeout(1500)
    await expect(win.locator('.backdrop-layer.shown')).toHaveCount(0)
  })
})

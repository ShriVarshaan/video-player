import type { ElectronApplication, Page } from '@playwright/test'

// Opens the top-left menu and picks a page: 'Search' | 'Home' | 'Settings'.
export async function goTo(win: Page, name: 'Search' | 'Home' | 'Settings') {
  await win.getByRole('button', { name: 'Menu' }).click()
  await win.getByRole('navigation', { name: 'Main' }).getByRole('button', { name }).click()
}

// Titles of every wall tile currently showing a title.
export const wallTitles = (win: Page) =>
  win.evaluate(() => [...new Set([...document.querySelectorAll<HTMLElement>('[data-testid="wall-tile"]:not([hidden])')].map((t) => t.dataset.title))])

// Clicks the first tile that is fully on screen and returns its title.
export async function clickAnyTile(win: Page): Promise<string> {
  const hit = await win.evaluate(() => {
    for (const t of document.querySelectorAll<HTMLElement>('[data-testid="wall-tile"]:not([hidden])')) {
      const r = t.getBoundingClientRect()
      if (r.left > 64 && r.top > 64 && r.right < innerWidth && r.bottom < innerHeight) {
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, title: t.dataset.title! }
      }
    }
    return null
  })
  if (!hit) throw new Error('no fully visible tile')
  await win.mouse.click(hit.x, hit.y)
  return hit.title
}

// Moves focus right until the title is focused (a row cycles through every title), then opens its card.
export async function openTile(win: Page, title: string) {
  const live = win.getByTestId('wall-live')
  for (let i = 0; i < 12 && !(await live.textContent())?.startsWith(title); i++) await win.keyboard.press('ArrowRight')
  if (!(await live.textContent())?.startsWith(title)) throw new Error(`could not focus ${title}`)
  await win.keyboard.press('Enter')
}

// The player's overlay window (controls), once it has opened.
export async function overlayPage(app: ElectronApplication): Promise<Page> {
  const find = () => app.windows().find((w) => w.url().endsWith('overlay.html'))
  const existing = find()
  if (existing) return existing
  return app.waitForEvent('window', { predicate: (w) => w.url().endsWith('overlay.html') })
}

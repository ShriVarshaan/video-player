import type { Page } from '@playwright/test'

// Opens the top-left menu and picks a page: 'Search' | 'Home' | 'Settings'.
export async function goTo(win: Page, name: 'Search' | 'Home' | 'Settings') {
  await win.getByRole('button', { name: 'Menu' }).click()
  await win.getByRole('navigation', { name: 'Main' }).getByRole('button', { name }).click()
}

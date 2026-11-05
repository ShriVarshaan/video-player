import { defineConfig } from '@playwright/test'

// Tests of the installed app itself: run `npm run package` first (release/win-unpacked).
export default defineConfig({
  testDir: 'tests/packaged',
  timeout: 120_000,
  workers: 1,
  reporter: 'list'
})

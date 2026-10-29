import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'

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
  await expect(win.getByRole('heading', { name: 'Video Player' })).toBeVisible()
  await expect(win.getByTestId('db-path')).toHaveText(join(userData, 'library.db'))
  expect(existsSync(join(userData, 'library.db'))).toBe(true)

  for (const name of ['mpv', 'ffmpeg', 'ffprobe']) {
    await expect(win.getByTestId(`bin-${name}`)).toHaveAttribute('data-exists', /^(true|false)$/)
  }
})

test('a second instance exits and leaves the first running', async () => {
  const win = await app.firstWindow()
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
  await expect(win.getByTestId('db-path')).toBeVisible()
})

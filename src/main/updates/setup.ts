import { app, ipcMain } from 'electron'
import type { API } from '@shared/api'
import { broadcast } from '../broadcast'
import { registerDomain } from '../ipc'
import { fixtureAdapter, liveAdapter, noUpdates, type FixtureMode } from './adapter'
import { createUpdateService, type UpdateAdapter } from './service'

const FIRST_CHECK_MS = 15_000
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000
const FIXTURE_MODES: readonly string[] = ['available', 'fail-check', 'fail-download']

// Only installed builds talk to GitHub; VP_UPDATE_MODE only works in development.
function pickAdapter(): UpdateAdapter {
  if (app.isPackaged) {
    // Loaded on the first check, so a failure to load counts as a failed check.
    let live: Promise<UpdateAdapter> | null = null
    const get = () => (live ??= liveAdapter())
    return {
      check: async () => (await get()).check(),
      download: async (onPercent) => (await get()).download(onPercent),
      quitAndInstall: () => void get().then((a) => a.quitAndInstall())
    }
  }
  const mode = process.env['VP_UPDATE_MODE'] ?? ''
  return FIXTURE_MODES.includes(mode) ? fixtureAdapter(mode as FixtureMode, () => app.quit()) : noUpdates
}

export function setupUpdates(settings: API['settings'], filmOpen: () => boolean): void {
  const service = createUpdateService({
    adapter: pickAdapter(),
    settings,
    emit: (state) => broadcast('updates.state', state),
    filmOpen
  })
  registerDomain(ipcMain, 'updates', service)
  const check = () => void service.check({ manual: false })
  setTimeout(check, FIRST_CHECK_MS).unref()
  setInterval(check, CHECK_EVERY_MS).unref()
}

import type { UpdateAdapter } from './service'

// The real thing, for installed builds. Downloading and installing happen only when asked:
// with these off, "Remind me later" and "Skip" can't install anything when the app quits.
export async function liveAdapter(): Promise<UpdateAdapter> {
  const { autoUpdater } = await import('electron-updater')
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  return {
    check: async () => {
      const result = await autoUpdater.checkForUpdates()
      if (!result?.isUpdateAvailable) return null
      return { version: result.updateInfo.version, notes: result.updateInfo.releaseNotes }
    },
    download: async (onPercent) => {
      const progress = (p: { percent: number }) => onPercent(Math.round(p.percent))
      autoUpdater.on('download-progress', progress)
      try {
        await autoUpdater.downloadUpdate()
      } finally {
        autoUpdater.off('download-progress', progress)
      }
    },
    // Silent: they already chose Install, so no second wizard. Then reopen the app.
    quitAndInstall: () => autoUpdater.quitAndInstall(true, true)
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export type FixtureMode = 'available' | 'fail-check' | 'fail-download'

// Development and E2E only (VP_UPDATE_MODE): acts out each path without a network call.
export function fixtureAdapter(mode: FixtureMode, quit: () => void): UpdateAdapter {
  return {
    check: async () => {
      if (mode === 'fail-check') throw new Error('fixture: check failed')
      return { version: '9.9.9', notes: '<h2>What changed</h2><p>Fixture release notes</p>' }
    },
    download: async (onPercent) => {
      if (mode === 'fail-download') throw new Error('fixture: download failed')
      for (const percent of [25, 50, 75, 100]) {
        await sleep(400)
        onPercent(percent)
      }
    },
    quitAndInstall: quit
  }
}

// A development run with no fixture: nothing to update to.
export const noUpdates: UpdateAdapter = {
  check: async () => null,
  download: async () => {},
  quitAndInstall: () => {}
}

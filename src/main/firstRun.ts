import type { API } from '@shared/api'
import { throwAppError } from '@shared/appError'
import { LINKS } from '@shared/links'

const COMPLETED = 'setup.completed'

export function createFirstRun(deps: {
  settings: API['settings']
  folderCount: () => number
  disabled: boolean
  openExternal: (url: string) => Promise<void>
}): Pick<API['app'], 'setupState' | 'finishSetup' | 'openLink'> {
  return {
    // Fresh installs only. Anyone with a library (a reinstall, an earlier build) counts as set up from
    // then on, so removing every folder later doesn't bring it back. Once done, folders aren't looked
    // at: checking one on a sleeping network drive could hold up the window.
    setupState: async () => {
      if (deps.disabled || (await deps.settings.get({ key: COMPLETED })) === true) return { show: false }
      if (deps.folderCount() === 0) return { show: true }
      await deps.settings.set({ key: COMPLETED, value: true })
      return { show: false }
    },
    finishSetup: async () => deps.settings.set({ key: COMPLETED, value: true }),
    openLink: async ({ id }) => {
      if (typeof id !== 'string' || !Object.hasOwn(LINKS, id)) throwAppError({ code: 'invalid_argument', message: 'Unknown link.' })
      await deps.openExternal(LINKS[id])
    }
  }
}

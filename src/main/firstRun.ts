import type { API } from '@shared/api'
import { throwAppError } from '@shared/appError'
import { LINKS } from '@shared/links'

const COMPLETED = 'setup.completed'

// Fresh installs only: anyone with a library (a reinstall, an earlier build) already set up.
export function shouldShowSetup(s: { completed: boolean; folderCount: number; disabled: boolean }): boolean {
  return !s.disabled && !s.completed && s.folderCount === 0
}

export function createFirstRun(deps: {
  settings: API['settings']
  folderCount: () => number
  disabled: boolean
  openExternal: (url: string) => Promise<void>
}): Pick<API['app'], 'setupState' | 'finishSetup' | 'openLink'> {
  return {
    setupState: async () => {
      const completed = (await deps.settings.get({ key: COMPLETED })) === true
      return { show: shouldShowSetup({ completed, folderCount: deps.folderCount(), disabled: deps.disabled }) }
    },
    finishSetup: async () => deps.settings.set({ key: COMPLETED, value: true }),
    openLink: async ({ id }) => {
      if (typeof id !== 'string' || !Object.hasOwn(LINKS, id)) throwAppError({ code: 'invalid_argument', message: 'Unknown link.' })
      await deps.openExternal(LINKS[id])
    }
  }
}

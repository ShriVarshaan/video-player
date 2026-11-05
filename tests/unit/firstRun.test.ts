import { describe, expect, it, vi } from 'vitest'
import type { Json } from '@shared/api'
import { parseAppError } from '@shared/appError'
import type { LinkId } from '@shared/links'
import { LINKS } from '@shared/links'
import { createFirstRun } from '../../src/main/firstRun'

function setup(folders = 0, disabled = false) {
  const store = new Map<string, Json>()
  const openExternal = vi.fn(async () => {})
  const library = { folders }
  const folderCount = vi.fn(() => library.folders)
  const firstRun = createFirstRun({
    settings: {
      get: async ({ key }) => store.get(key) ?? null,
      set: async ({ key, value }) => void store.set(key, value)
    },
    folderCount,
    disabled,
    openExternal
  })
  return { firstRun, openExternal, library, folderCount, store }
}

describe('createFirstRun', () => {
  it('stops showing once finished', async () => {
    const { firstRun } = setup()
    expect(await firstRun.setupState({})).toEqual({ show: true })
    await firstRun.finishSetup({})
    expect(await firstRun.setupState({})).toEqual({ show: false })
  })

  it("doesn't show when a library already exists", async () => {
    expect(await setup(2).firstRun.setupState({})).toEqual({ show: false })
  })

  it('removing every folder later does not bring it back for someone who already had a library', async () => {
    const { firstRun, library } = setup(1)
    expect(await firstRun.setupState({})).toEqual({ show: false })
    library.folders = 0
    expect(await firstRun.setupState({})).toEqual({ show: false })
  })

  it('never looks at folders once setup is done, so a sleeping network drive cannot hold up the window', async () => {
    const { firstRun, folderCount } = setup()
    await firstRun.finishSetup({})
    folderCount.mockClear()
    await firstRun.setupState({})
    expect(folderCount).not.toHaveBeenCalled()
  })

  it('a run with setup switched off records nothing', async () => {
    const { firstRun, store } = setup(1, true)
    expect(await firstRun.setupState({})).toEqual({ show: false })
    expect(store.size).toBe(0)
  })

  it('opens only links on the fixed list', async () => {
    const { firstRun, openExternal } = setup()
    await firstRun.openLink({ id: 'tmdbSignup' })
    expect(openExternal).toHaveBeenCalledWith(LINKS.tmdbSignup)
    openExternal.mockClear()
    for (const id of ['https://evil.example', 'toString', '__proto__']) {
      const error = await firstRun.openLink({ id: id as LinkId }).catch((e: unknown) => e)
      expect(parseAppError(error)?.code).toBe('invalid_argument')
    }
    expect(openExternal).not.toHaveBeenCalled()
  })
})

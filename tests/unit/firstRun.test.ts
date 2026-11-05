import { describe, expect, it, vi } from 'vitest'
import type { Json } from '@shared/api'
import { parseAppError } from '@shared/appError'
import type { LinkId } from '@shared/links'
import { LINKS } from '@shared/links'
import { createFirstRun, shouldShowSetup } from '../../src/main/firstRun'

function setup(folders = 0, disabled = false) {
  const store = new Map<string, Json>()
  const openExternal = vi.fn(async () => {})
  const firstRun = createFirstRun({
    settings: {
      get: async ({ key }) => store.get(key) ?? null,
      set: async ({ key, value }) => void store.set(key, value)
    },
    folderCount: () => folders,
    disabled,
    openExternal
  })
  return { firstRun, openExternal }
}

describe('shouldShowSetup', () => {
  it('shows on a fresh install only', () => {
    expect(shouldShowSetup({ completed: false, folderCount: 0, disabled: false })).toBe(true)
    expect(shouldShowSetup({ completed: true, folderCount: 0, disabled: false })).toBe(false)
    expect(shouldShowSetup({ completed: false, folderCount: 1, disabled: false })).toBe(false)
    expect(shouldShowSetup({ completed: false, folderCount: 0, disabled: true })).toBe(false)
  })
})

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

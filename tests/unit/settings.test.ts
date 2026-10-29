import { describe, expect, it } from 'vitest'
import { parseAppError } from '@shared/appError'
import { openDb } from '../../src/main/db'
import { createSettings } from '../../src/main/settings'

describe('settings', () => {
  it('returns null for a key that was never set', async () => {
    const settings = createSettings(openDb(':memory:'))
    expect(await settings.get({ key: 'missing' })).toBeNull()
  })

  it('round-trips a JSON value', async () => {
    const settings = createSettings(openDb(':memory:'))
    const value = { scale: 1.5, tags: ['a'], on: true, none: null }
    await settings.set({ key: 'ui', value })
    expect(await settings.get({ key: 'ui' })).toEqual(value)
  })

  it('overwrites an existing value', async () => {
    const settings = createSettings(openDb(':memory:'))
    await settings.set({ key: 'volume', value: 100 })
    await settings.set({ key: 'volume', value: 150 })
    expect(await settings.get({ key: 'volume' })).toBe(150)
  })

  it('keeps tmdb.* keys away from the renderer', async () => {
    const settings = createSettings(openDb(':memory:'))
    const get = await settings.get({ key: 'tmdb.credential' }).catch((err: unknown) => err)
    const set = await settings.set({ key: 'tmdb.credential', value: 'x' }).catch((err: unknown) => err)
    expect(parseAppError(get)?.code).toBe('invalid_argument')
    expect(parseAppError(set)?.code).toBe('invalid_argument')
  })

  it('rejects an empty key', async () => {
    const settings = createSettings(openDb(':memory:'))
    const e = await settings.set({ key: '', value: 1 }).catch((err: unknown) => err)
    expect(parseAppError(e)?.code).toBe('invalid_argument')
  })
})

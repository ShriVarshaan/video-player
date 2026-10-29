import { describe, expect, it, vi } from 'vitest'
import type { API } from '@shared/api'
import { AppErrorClass, parseAppError, throwAppError } from '@shared/appError'
import { registerDomain } from '../../src/main/ipc'

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>

function fakeIpc() {
  const handlers = new Map<string, Handler>()
  return {
    handlers,
    handle: (channel: string, fn: Handler) => {
      handlers.set(channel, fn)
    }
  }
}

function settingsHandlers(overrides: Partial<API['settings']> = {}): API['settings'] {
  return { get: vi.fn(async () => null), set: vi.fn(async () => {}), ...overrides }
}

describe('registerDomain', () => {
  it('registers one derived channel per method', () => {
    const ipc = fakeIpc()
    registerDomain(ipc, 'settings', settingsHandlers())
    expect([...ipc.handlers.keys()]).toEqual(['vp:settings.get', 'vp:settings.set'])
  })

  it('passes the params object to the handler', async () => {
    const ipc = fakeIpc()
    const handlers = settingsHandlers({ get: vi.fn(async () => 7) })
    registerDomain(ipc, 'settings', handlers)
    expect(await ipc.handlers.get('vp:settings.get')!({}, { key: 'k' })).toBe(7)
    expect(handlers.get).toHaveBeenCalledWith({ key: 'k' })
  })

  it('wraps an ordinary error as an AppError with code unknown', async () => {
    const ipc = fakeIpc()
    registerDomain(
      ipc,
      'settings',
      settingsHandlers({
        get: async () => {
          throw new Error('boom')
        }
      })
    )
    const e = await ipc.handlers.get('vp:settings.get')!({}, { key: 'k' }).catch((x: unknown) => x)
    expect(e).toBeInstanceOf(AppErrorClass)
    expect(parseAppError(e)).toMatchObject({ code: 'unknown', payload: { cause: 'boom' } })
  })

  it('keeps the code of an AppError', async () => {
    const ipc = fakeIpc()
    registerDomain(
      ipc,
      'settings',
      settingsHandlers({ set: async () => throwAppError('invalid_argument') })
    )
    const e = await ipc.handlers
      .get('vp:settings.set')!({}, { key: '', value: 1 })
      .catch((x: unknown) => x)
    expect(parseAppError(e)?.code).toBe('invalid_argument')
  })
})

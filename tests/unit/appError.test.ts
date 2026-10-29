import { describe, expect, it, vi } from 'vitest'
import {
  AppErrorClass,
  appErrorMessages,
  catchAppError,
  parseAppError,
  throwAppError
} from '@shared/appError'

function caught(fn: () => unknown): unknown {
  try {
    fn()
  } catch (e) {
    return e
  }
  throw new Error('expected a throw')
}

describe('throwAppError', () => {
  it('throws an AppErrorClass carrying the code and default message', () => {
    const e = caught(() => throwAppError('db_too_new'))
    expect(e).toBeInstanceOf(AppErrorClass)
    expect(parseAppError(e)).toEqual({
      code: 'db_too_new',
      message: appErrorMessages.db_too_new
    })
  })

  it('keeps a custom message and payload', () => {
    const e = caught(() =>
      throwAppError({ code: 'invalid_argument', message: 'bad key', payload: { key: '' } })
    )
    expect(parseAppError(e)).toEqual({
      code: 'invalid_argument',
      message: 'bad key',
      payload: { key: '' }
    })
  })
})

describe('parseAppError', () => {
  it('strips the prefix Electron adds across IPC', () => {
    const body = { code: 'invalid_argument', message: 'm', payload: { k: 1 } }
    const e = new Error(`Error invoking remote method 'x': Error: ${JSON.stringify(body)}`)
    expect(parseAppError(e)).toEqual(body)
  })

  it('keeps the code when the payload contains braces', () => {
    const e = caught(() =>
      throwAppError({ code: 'db_migration_failed', payload: { cause: 'near "}": syntax error' } })
    )
    const wrapped = new Error(`Error invoking remote method 'x': ${(e as Error).message}`)
    expect(parseAppError(wrapped)?.code).toBe('db_migration_failed')
  })

  it('returns null for an ordinary error', () => {
    expect(parseAppError(new Error('plain'))).toBeNull()
  })
})

describe('catchAppError', () => {
  it('routes to the handler for the code', () => {
    const onCode = vi.fn()
    const onDefault = vi.fn()
    catchAppError(caught(() => throwAppError('db_too_new')), {
      db_too_new: onCode,
      DEFAULT: onDefault
    })
    expect(onCode).toHaveBeenCalledOnce()
    expect(onDefault).not.toHaveBeenCalled()
  })

  it('falls back to DEFAULT with code unknown for a non-app error', () => {
    const onDefault = vi.fn()
    catchAppError(new Error('plain'), { DEFAULT: onDefault })
    expect(onDefault.mock.calls[0]?.[0].code).toBe('unknown')
  })
})
